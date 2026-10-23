import { createForegroundRenderer } from "../../../packages/studio/src/foreground";

export async function foregroundChecks(report: (message: string) => void) {
  const input = document.createElement("canvas");
  input.width = 640;
  input.height = 360;
  const context = input.getContext("2d")!;
  let portrait: HTMLImageElement | undefined;
  const paint = () => {
    context.fillStyle = "#228844";
    context.fillRect(0, 0, input.width, input.height);
    if (portrait) context.drawImage(portrait, 0, 0, input.width, input.height);
  };
  paint();
  const interval = setInterval(paint, 1000 / 30);
  const stream = input.captureStream(30);
  const video = document.createElement("video");
  video.muted = true;
  video.srcObject = stream;
  const output = document.createElement("canvas");
  let renderer: Awaited<ReturnType<typeof createForegroundRenderer>> | undefined;
  const sample = async () => {
    await new Promise((resolve) => setTimeout(resolve, 150));
    renderer!.render(video, performance.now());
    const gl = output.getContext("webgl2")!;
    const pixels = new Uint8Array(output.width * output.height * 4);
    gl.readPixels(0, 0, output.width, output.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    let clear = 0,
      opaque = 0,
      xTotal = 0,
      yTotal = 0;
    for (let i = 3; i < pixels.length; i += 4) {
      if (pixels[i]! < 10) clear++;
      if (pixels[i]! > 240) {
        opaque++;
        const pixel = (i - 3) / 4;
        xTotal += pixel % output.width;
        yTotal += Math.floor(pixel / output.width);
      }
    }
    if (gl.getError() !== gl.NO_ERROR) throw new Error("Presenter cutout produced a GPU error.");
    return {
      clear,
      opaque,
      total: pixels.length / 4,
      x: xTotal / opaque,
      y: yTotal / opaque,
    };
  };
  try {
    await video.play();
    renderer = await createForegroundRenderer(output);
    const empty = await sample();
    if (empty.clear < empty.total * 0.95)
      throw new Error("An empty camera background should be transparent.");
    const image = new Image();
    image.crossOrigin = "anonymous";
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () =>
        reject(new Error("The public MediaPipe sample portrait failed to load."));
      image.src = "https://storage.googleapis.com/mediapipe-assets/portrait.jpg";
    });
    portrait = image;
    const person = await sample();
    if (person.clear < 1000 || person.opaque < 1000)
      throw new Error("The presenter must stay opaque while its background becomes transparent.");
    report("PASS real-model presenter foreground and transparent background pixels");
    for (const [width, height] of [[1280, 720], [1920, 1080]] as const) {
      input.width = width;
      input.height = height;
      const highResolution = await sample();
      if (output.width !== 640 || output.height !== 360)
        throw new Error(`${width} × ${height} camera changed the cutout rendering dimensions.`);
      if (
        highResolution.opaque < person.opaque * 0.85 ||
        Math.abs(highResolution.x - person.x) > 10 ||
        Math.abs(highResolution.y - person.y) > 10
      )
        throw new Error(`${width} × ${height} camera shrank or displaced the presenter cutout.`);
    }
    report("PASS 720p and 1080p cameras preserve presenter size and position");
    input.width = 320;
    input.height = 180;
    await sample();
    if (output.width !== 320 || output.height !== 180)
      throw new Error("Presenter cutout did not follow camera resolution changes.");
    portrait = undefined;
    const cleared = await sample();
    if (cleared.clear < cleared.total * 0.95)
      throw new Error("Departed presenter left an old silhouette on the screen.");
    report("PASS cutout resize and foreground clearing without an opaque camera rectangle");
  } finally {
    renderer?.close();
    clearInterval(interval);
    stream.getTracks().forEach((track) => track.stop());
    video.pause();
    video.srcObject = null;
  }
}
