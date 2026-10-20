import { LocalVideoTrack } from "livekit-client";
import { ProcessorWrapper } from "@livekit/track-processors";
import { BackgroundMaskFilter } from "../src/background-mask";
import { stableBackgroundProcessor, type CameraForegroundMode } from "../src/background-processor";
import { applyCameraEffect } from "../src/devices";
import { usePreferences } from "../src/store";
import { foregroundChecks } from "./foreground-browser";

const results = document.querySelector<HTMLPreElement>("#results")!;
const button = document.querySelector<HTMLButtonElement>("#run")!;
const preview = document.querySelector<HTMLVideoElement>("#preview")!;
const assert = (condition: boolean, message: string) => {
  if (!condition) throw new Error(message);
};
const report = (message: string) => {
  results.textContent += `${message}\n`;
};
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function maskChecks() {
  const gl = new OffscreenCanvas(8, 8).getContext("webgl2")!;
  const filter = new BackgroundMaskFilter(gl);
  const confidence = gl.createTexture()!;
  const accessoryTexture = gl.createTexture()!;
  const output = gl.createFramebuffer()!;
  const frame = new OffscreenCanvas(8, 8);
  const context = frame.getContext("2d")!;
  const color = (value: string) => {
    context.fillStyle = value;
    context.fillRect(0, 0, 8, 8);
  };
  color("#404040");
  let timestamp = 0;
  const sample = (
    person: number,
    elapsed = 1000 / 30,
    background = false,
    width = 8,
    height = 8,
    accessoryConfidence?: number,
  ) => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, confidence);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.R8,
      width,
      height,
      0,
      gl.RED,
      gl.UNSIGNED_BYTE,
      new Uint8Array(width * height).fill(Math.round(person * 255)),
    );
    timestamp += elapsed;
    if (accessoryConfidence !== undefined) {
      gl.activeTexture(gl.TEXTURE5);
      gl.bindTexture(gl.TEXTURE_2D, accessoryTexture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.R8,
        width,
        height,
        0,
        gl.RED,
        gl.UNSIGNED_BYTE,
        new Uint8Array(width * height).fill(Math.round(accessoryConfidence * 255)),
      );
    }
    const texture = filter.apply(
      confidence,
      width,
      height,
      frame,
      timestamp,
      background,
      accessoryConfidence === undefined ? undefined : accessoryTexture,
    );
    gl.bindFramebuffer(gl.FRAMEBUFFER, output);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    const pixel = new Uint8Array(4);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    assert(gl.getError() === gl.NO_ERROR, "GPU filter produced a WebGL error");
    return 1 - pixel[0]! / 255;
  };
  try {
    assert(sample(1) > 0.99, "First foreground frame must be immediate");
    const jitter: number[] = [];
    for (let i = 0; i < 40; i++) jitter.push(sample(i % 2 ? 0.35 : 0.6));
    const settled = jitter.slice(20);
    const swing = Math.max(...settled) - Math.min(...settled);
    assert(swing < 0.2, `Stationary edge jitter too high: ${swing}`);
    assert(Math.min(...settled) > 0.5, "Uncertain foreground edges repeatedly disappeared");
    report(`PASS stationary edge stability: ${(swing * 100).toFixed(1)}% mask swing`);
    filter.reset();
    sample(1);
    const oscillation: number[] = [];
    for (let i = 0; i < 40; i++) oscillation.push(sample(i % 2 ? 1 : 0));
    assert(
      Math.min(...oscillation) > 0.5,
      "Hard mask oscillation repeatedly removed a stationary object",
    );
    report("PASS stationary edges survive alternating 0/1 segmentation confidence");
    color("#e0e0e0");
    assert(sample(0) < 0.01, "Moving foreground must clear immediately without a trail");
    color("#404040");
    assert(sample(1) > 0.99, "Moving foreground must appear immediately");
    report("PASS moving edges respond immediately without holding the previous silhouette");
    for (let i = 0; i < 12; i++) sample(0);
    assert(sample(0) < 0.04, "Stationary departed foreground must eventually clear");
    sample(1);
    assert(sample(0, 300) < 0.01, "Paused input must discard stale history");
    filter.reset();
    assert(sample(1) > 0.99, "Camera restart must discard stale history");
    assert(sample(0, 33, false, 16, 8) < 0.01, "Mask resize must discard stale history");
    filter.reset();
    assert(sample(1, 33, true) < 0.01, "Background-labelled confidence must be inverted");
    report("PASS foreground clearing, pause, restart, resize, confidence orientation");
    const convergence: number[] = [];
    for (const fps of [30, 60]) {
      filter.reset();
      sample(0);
      let value = 0;
      for (let i = 0; i < fps / 5; i++) value = sample(0.7, 1000 / fps);
      convergence.push(value);
    }
    assert(Math.abs(convergence[0]! - convergence[1]!) < 0.04, "Stability depends on frame rate");
    report("PASS equivalent mask response at 30 and 60 fps");
    filter.reset();
    assert(
      sample(0.05, 33, true, 8, 8) > 0.99,
      "Low background confidence should retain a foreground pixel",
    );
    filter.reset();
    assert(
      sample(0.05, 33, true, 8, 8, 0.85) < 0.01,
      "Accessory-classified foreground must be removed",
    );
    filter.reset();
    assert(sample(0.02, 33, true, 8, 8, 0.02) > 0.99, "Human classes must be retained");
    filter.reset();
    assert(
      sample(0.95, 33, true, 8, 8, 0.3) < 0.01,
      "Excluded probabilities must be clamped safely",
    );
    report("PASS person-only keeps human classes and removes accessories on the GPU");
  } finally {
    filter.destroy();
    gl.deleteFramebuffer(output);
    gl.deleteTexture(confidence);
    gl.deleteTexture(accessoryTexture);
    gl.getExtension("WEBGL_lose_context")?.loseContext();
  }
}

async function processorChecks(fallback = false, foregroundMode: CameraForegroundMode = "stable") {
  const modernSupport = Object.getOwnPropertyDescriptor(ProcessorWrapper, "hasModernApiSupport")!;
  if (fallback)
    Object.defineProperty(ProcessorWrapper, "hasModernApiSupport", {
      configurable: true,
      get: () => false,
    });
  const canvas = document.createElement("canvas");
  canvas.width = 640;
  canvas.height = 360;
  const context = canvas.getContext("2d")!;
  const paint = () => {
    for (let y = 0; y < 360; y += 20)
      for (let x = 0; x < 640; x += 20) {
        context.fillStyle = (x + y) % 40 ? "#333333" : "#dddddd";
        context.fillRect(x, y, 20, 20);
      }
  };
  paint();
  const interval = setInterval(paint, 1000 / 30);
  const track = new LocalVideoTrack(canvas.captureStream(30).getVideoTracks()[0]!);
  let replacement: MediaStreamTrack | undefined;
  const background = document.createElement("canvas");
  background.width = 32;
  background.height = 32;
  const backgroundContext = background.getContext("2d")!;
  backgroundContext.fillStyle = "#ee1122";
  backgroundContext.fillRect(0, 0, 32, 32);
  let frames = 0;
  const processor = stableBackgroundProcessor(
    {
      imagePath: background.toDataURL(),
      onFrameProcessed: () => {
        frames++;
      },
    },
    30,
    foregroundMode,
  );
  const waitForFrames = async () => {
    const initial = frames;
    for (let i = 0; i < 100 && frames < initial + 5; i++) await pause(100);
    assert(
      frames >= initial + 5,
      `Processed video stopped delivering frames: source=${processor.source?.readyState}, output=${processor.processedTrack?.readyState}, paused=${(processor.sourceDummy as HTMLVideoElement)?.paused}, frames=${frames - initial}`,
    );
  };
  const pixel = () => {
    const probe = document.createElement("canvas");
    probe.width = 640;
    probe.height = 360;
    const ctx = probe.getContext("2d")!;
    ctx.drawImage(preview, 0, 0, 640, 360);
    return Array.from(ctx.getImageData(320, 180, 1, 1).data);
  };
  try {
    await track.setProcessor(processor);
    track.attach(preview);
    await preview.play();
    await waitForFrames();
    const red = pixel();
    assert(red[0]! > 200 && red[1]! < 50, `Virtual background pixels are incorrect: ${red}`);
    report(
      `PASS real MediaPipe image replacement (${red}); labels: ${processor.transformer.imageSegmenter?.getLabels()}`,
    );
    await processor.switchTo({ mode: "background-blur", blurRadius: 12 });
    await waitForFrames();
    const blur = pixel();
    assert(Math.abs(blur[0]! - blur[1]!) < 5, "Switching to blur kept the old background image");
    report(`PASS switching to blur reuses the processor and track (${blur})`);
    for (let restart = 0; restart < 2; restart++) {
      replacement?.stop();
      replacement = canvas.captureStream(30).getVideoTracks()[0]!;
      const input = processor.sourceDummy as HTMLVideoElement;
      input.srcObject = new MediaStream([replacement]);
      await input.play();
      await processor.restart({ kind: track.kind, track: replacement, element: input });
      track.detach(preview);
      track.attach(preview);
      await preview.play();
      await waitForFrames();
      assert(
        processor.processedTrack?.readyState === "live",
        "Old stream cleanup stopped restarted video",
      );
    }
    report("PASS camera processor restart creates fresh mask history and continues rendering");
    await track.stopProcessor();
    report("PASS disabling the effect releases the processor");
  } finally {
    clearInterval(interval);
    track.detach(preview);
    track.stop();
    replacement?.stop();
    Object.defineProperty(ProcessorWrapper, "hasModernApiSupport", modernSupport);
  }
}

async function preferenceChecks() {
  const previous = usePreferences.getState();
  const canvas = document.createElement("canvas");
  canvas.width = 320;
  canvas.height = 180;
  const ctx = canvas.getContext("2d")!;
  const paint = () => {
    ctx.fillStyle = "#888888";
    ctx.fillRect(0, 0, 320, 180);
  };
  paint();
  const timer = setInterval(paint, 33);
  const raw = canvas.captureStream(30).getVideoTracks()[0]!;
  const camera = new LocalVideoTrack(raw);
  try {
    usePreferences.setState({
      effect: "image",
      foregroundMode: "stable",
      localBackground: { url: canvas.toDataURL(), name: "test" },
    });
    await applyCameraEffect(camera);
    const stable = camera.getProcessor();
    usePreferences.setState({ foregroundMode: "person-only" });
    await applyCameraEffect(camera);
    const person = camera.getProcessor() as ReturnType<typeof stableBackgroundProcessor>;
    assert(
      person !== stable && person.foregroundMode === "person-only",
      "Changing foreground mode reused the wrong model",
    );
    assert(
      person.source === raw && raw.readyState === "live",
      "Changing model restarted camera capture",
    );
    usePreferences.setState({ effect: "blur", blurRadius: 20 });
    await applyCameraEffect(camera);
    assert(
      camera.getProcessor() === person && person.mode === "background-blur",
      "Changing effects failed to reuse the person model",
    );
    usePreferences.setState({ foregroundMode: "stable" });
    await applyCameraEffect(camera);
    assert(
      camera.getProcessor() !== person,
      "Returning to Stable foreground retained the person-only model",
    );
    usePreferences.setState({ effect: "none" });
    await applyCameraEffect(camera);
    assert(!camera.getProcessor(), "Disabling camera effects kept the processor");
    report(
      "PASS saved foreground preferences select the correct model, reuse it for effect changes, and disable it cleanly",
    );
  } finally {
    clearInterval(timer);
    await camera.stopProcessor();
    camera.stop();
    usePreferences.setState(previous);
  }
}

button.addEventListener("click", async () => {
  button.disabled = true;
  results.textContent = "Running GPU checks…\n";
  try {
    maskChecks();
    await foregroundChecks(report);
    await processorChecks();
    report("Checking canvas capture fallback…");
    await processorChecks(true);
    report("Checking person-only mode…");
    await processorChecks(false, "person-only");
    report("Checking person-only canvas fallback…");
    await processorChecks(true, "person-only");
    await preferenceChecks();
    report("ALL BROWSER CHECKS PASSED");
  } catch (error) {
    report(`FAIL ${error instanceof Error ? error.stack : error}`);
  } finally {
    button.disabled = false;
  }
});
