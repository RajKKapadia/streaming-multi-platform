// Composite after LiveKit decoding: camera tracks sent over WebRTC do not retain alpha.
// Both the studio and the outgoing renderer therefore remove the background here.
export async function createForegroundRenderer(canvas: HTMLCanvasElement) {
  const { DrawingUtils, FilesetResolver, ImageSegmenter } = await import("@mediapipe/tasks-vision");
  const gl = canvas.getContext("webgl2", { alpha: true, premultipliedAlpha: true });
  if (!gl) throw new Error("Background removal requires a browser with WebGL 2.");
  const files = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm",
  );
  const segmenter = await ImageSegmenter.createFromOptions(files, {
    baseOptions: {
      modelAssetPath:
        "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite",
      delegate: "GPU",
    },
    canvas,
    runningMode: "VIDEO",
    outputCategoryMask: false,
    outputConfidenceMasks: true,
  });
  const drawing = new DrawingUtils(gl);
  const backgroundFirst = segmenter.getLabels()[0]?.toLowerCase() === "background";
  return {
    render(video: HTMLVideoElement, timestamp: number) {
      // The inset is 324 × 276. Limit GPU work while retaining enough detail at 1080p.
      const width = Math.min(640, video.videoWidth);
      const height = Math.max(1, Math.round((width * video.videoHeight) / video.videoWidth));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      segmenter.segmentForVideo(video, timestamp, (result) => {
        const mask = result.confidenceMasks?.[0];
        if (!mask) throw new Error("The presenter foreground mask is unavailable.");
        gl.viewport(0, 0, width, height);
        drawing.drawConfidenceMask(
          mask,
          backgroundFirst ? video : [0, 0, 0, 0],
          backgroundFirst ? [0, 0, 0, 0] : video,
        );
      });
    },
    close() {
      drawing.close();
      segmenter.close();
    },
  };
}
