// Keep the mask and its history on the GPU. Reading segmentation pixels back to the CPU on
// every frame stalls the camera pipeline, particularly while screen sharing.
const vertexSource = `#version 300 es
in vec2 position;
out vec2 uv;
void main() {
  uv = (position + 1.0) * 0.5;
  gl_Position = vec4(position, 0.0, 1.0);
}`;

const fragmentSource = `#version 300 es
precision highp float;
in vec2 uv;
uniform sampler2D confidence;
uniform sampler2D accessories;
uniform sampler2D camera;
uniform sampler2D previous;
uniform sampler2D previousMask;
uniform float historyWeight;
uniform bool confidenceIsBackground;
uniform bool excludeAccessories;
layout(location = 0) out vec4 history;
layout(location = 1) out vec4 backgroundMask;
void main() {
  vec3 color = texture(camera, uv).rgb;
  vec4 old = texture(previous, uv);
  float raw = texture(confidence, uv).r;
  if (excludeAccessories) raw = min(1.0, raw + texture(accessories, uv).r);
  float person = confidenceIsBackground ? 1.0 - raw : raw;
  // Hysteresis discourages uncertain pixels from repeatedly switching sides. Confident
  // background still clears; a small foreground bias helps retain thin hand edges.
  float bias = historyWeight > 0.0 ? (old.a >= 0.5 ? 0.06 : -0.06) : 0.0;
  float target = smoothstep(0.3, 0.65, person + bias);
  vec3 difference = abs(color - old.rgb);
  float motion = smoothstep(0.04, 0.18, max(difference.r, max(difference.g, difference.b)));
  float stable = mix(target, old.a, historyWeight * (1.0 - motion));
  history = vec4(color, stable);
  // Keep a separate decision history so even near-binary 0/1 model oscillation cannot
  // flip a stationary edge on every frame. Motion bypasses this wider dead band.
  float wasForeground = 1.0 - texture(previousMask, uv).r;
  float threshold = historyWeight > 0.0 ? (wasForeground >= 0.5 ? 0.35 : 0.6) : 0.5;
  threshold = mix(threshold, 0.5, motion);
  float foreground = smoothstep(threshold - 0.08, threshold + 0.08, stable);
  // LiveKit's compositor expects 0 for the person and 1 for the background.
  backgroundMask = vec4(vec3(1.0 - foreground), 1.0);
}`;

export class BackgroundMaskFilter {
  private program: WebGLProgram;
  private vertices: WebGLBuffer;
  private vertexArray: WebGLVertexArrayObject;
  private framebuffer: WebGLFramebuffer;
  private camera: WebGLTexture;
  private masks: WebGLTexture[];
  private history: WebGLTexture[];
  private uniforms: Record<string, WebGLUniformLocation | null>;
  private width = 0;
  private height = 0;
  private index = 0;
  private timestamp: number | undefined;

  constructor(private gl: WebGL2RenderingContext) {
    const compile = (type: number, source: string) => {
      const shader = gl.createShader(type)!;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        const error = gl.getShaderInfoLog(shader);
        gl.deleteShader(shader);
        throw new Error(`Could not initialize background edge stability: ${error}`);
      }
      return shader;
    };
    const vertex = compile(gl.VERTEX_SHADER, vertexSource);
    const fragment = compile(gl.FRAGMENT_SHADER, fragmentSource);
    this.program = gl.createProgram()!;
    gl.attachShader(this.program, vertex);
    gl.attachShader(this.program, fragment);
    gl.linkProgram(this.program);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    if (!gl.getProgramParameter(this.program, gl.LINK_STATUS))
      throw new Error("Could not initialize background edge stability.");
    this.uniforms = Object.fromEntries(
      [
        "confidence",
        "accessories",
        "camera",
        "previous",
        "previousMask",
        "historyWeight",
        "confidenceIsBackground",
        "excludeAccessories",
      ].map((name) => [name, gl.getUniformLocation(this.program, name)]),
    );
    this.vertices = gl.createBuffer()!;
    this.vertexArray = gl.createVertexArray()!;
    gl.bindVertexArray(this.vertexArray);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vertices);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(this.program, "position");
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    const texture = () => {
      const value = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, value);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return value;
    };
    this.camera = texture();
    this.masks = [texture(), texture()];
    this.history = [texture(), texture()];
    this.framebuffer = gl.createFramebuffer()!;
  }

  reset() {
    this.timestamp = undefined;
  }

  apply(
    confidence: WebGLTexture,
    width: number,
    height: number,
    frame: TexImageSource,
    timestampMs: number,
    confidenceIsBackground = false,
    accessories?: WebGLTexture,
  ): WebGLTexture {
    const gl = this.gl;
    if (width !== this.width || height !== this.height) {
      this.width = width;
      this.height = height;
      for (const texture of [...this.history, ...this.masks]) {
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      }
      this.reset();
    }
    // Frame timestamps are in milliseconds here. Reset after pauses/restarts; never blend
    // an old camera position into a new one. The time constant works at both 30 and 60 fps.
    const elapsed = this.timestamp === undefined ? Infinity : timestampMs - this.timestamp;
    const weight = elapsed > 0 && elapsed < 250 ? Math.exp(-elapsed / 120) : 0;
    this.timestamp = timestampMs;
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vertexArray);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, confidence);
    gl.uniform1i(this.uniforms.confidence!, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.camera);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, frame);
    gl.uniform1i(this.uniforms.camera!, 1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.history[this.index]!);
    gl.uniform1i(this.uniforms.previous!, 2);
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, this.masks[this.index]!);
    gl.uniform1i(this.uniforms.previousMask!, 3);
    gl.activeTexture(gl.TEXTURE4);
    gl.bindTexture(gl.TEXTURE_2D, accessories ?? confidence);
    gl.uniform1i(this.uniforms.accessories!, 4);
    gl.uniform1i(this.uniforms.excludeAccessories!, accessories ? 1 : 0);
    gl.uniform1f(this.uniforms.historyWeight!, weight);
    gl.uniform1i(this.uniforms.confidenceIsBackground!, confidenceIsBackground ? 1 : 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
    const next = 1 - this.index;
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      this.history[next]!,
      0,
    );
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT1,
      gl.TEXTURE_2D,
      this.masks[next]!,
      0,
    );
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
    gl.viewport(0, 0, width, height);
    const blending = gl.isEnabled(gl.BLEND);
    gl.disable(gl.BLEND);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (blending) gl.enable(gl.BLEND);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindVertexArray(null);
    this.index = next;
    return this.masks[next]!;
  }

  destroy() {
    const gl = this.gl;
    for (const texture of [...this.history, ...this.masks, this.camera]) gl.deleteTexture(texture);
    gl.deleteFramebuffer(this.framebuffer);
    gl.deleteVertexArray(this.vertexArray);
    gl.deleteBuffer(this.vertices);
    gl.deleteProgram(this.program);
  }
}
