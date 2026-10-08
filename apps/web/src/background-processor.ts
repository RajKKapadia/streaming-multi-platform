import {
  BackgroundProcessorWrapper,
  BackgroundTransformer,
  type BackgroundOptions,
  type TrackTransformerDestroyOptions,
  type VideoTransformerInitOptions,
} from "@livekit/track-processors";
import { BackgroundMaskFilter } from "./background-mask";
import type { ProcessorOptions, Track } from "livekit-client";

export type CameraForegroundMode = "stable" | "person-only";
const personModel =
  "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite";

class StableBackgroundTransformer extends BackgroundTransformer {
  private maskFilter?: BackgroundMaskFilter;
  private confidenceIsBackground = false;

  constructor(
    options: BackgroundOptions,
    private foregroundMode: CameraForegroundMode,
  ) {
    super(options);
  }

  override async init(options: VideoTransformerInitOptions) {
    try {
      await super.init(options);
      // A confidence mask retains uncertainty that the SDK's binary category mask discards.
      await this.imageSegmenter!.setOptions({
        outputConfidenceMasks: true,
        outputCategoryMask: false,
      });
      const labels = this.imageSegmenter!.getLabels();
      this.confidenceIsBackground = labels[0]?.toLowerCase() === "background";
      if (
        this.foregroundMode === "person-only" &&
        (!this.confidenceIsBackground || labels[5] !== "others")
      )
        throw new Error(
          "The person-only camera model is unavailable. Select Stable foreground to continue.",
        );
      const gl = this.canvas!.getContext("webgl2") as WebGL2RenderingContext;
      this.maskFilter = new BackgroundMaskFilter(gl);
    } catch (error) {
      await this.destroy();
      throw error;
    }
  }

  override async transform(
    frame: VideoFrame,
    controller: TransformStreamDefaultController<VideoFrame>,
  ) {
    let forwarded = false;
    try {
      if (!frame.codedWidth || !frame.codedHeight) return;
      if (this.isDisabled || this.options.backgroundDisabled) {
        controller.enqueue(frame);
        forwarded = true;
        return;
      }
      const canvas = this.canvas;
      if (!canvas || !this.imageSegmenter || !this.gl || !this.maskFilter) return;
      const started = performance.now();
      if (canvas.width !== frame.displayWidth || canvas.height !== frame.displayHeight) {
        canvas.width = frame.displayWidth;
        canvas.height = frame.displayHeight;
        this.maskFilter.reset();
      }
      this.imageSegmenter.segmentForVideo(frame, started, (result) => {
        try {
          this.segmentationTimeMs = performance.now() - started;
          const confidence = result.confidenceMasks?.[0];
          if (!confidence) throw new Error("The camera background confidence mask is unavailable.");
          const accessories =
            this.foregroundMode === "person-only" ? result.confidenceMasks?.[5] : undefined;
          if (this.foregroundMode === "person-only" && !accessories)
            throw new Error("The person-only camera accessory mask is unavailable.");
          // Multiclass probabilities sum to one. Excluding background + accessories keeps
          // hair, body skin, face skin, and clothing without reading masks back to the CPU.
          const mask = this.maskFilter!.apply(
            confidence.getAsWebGLTexture(),
            confidence.width,
            confidence.height,
            frame,
            frame.timestamp / 1000,
            this.confidenceIsBackground,
            accessories?.getAsWebGLTexture(),
          );
          this.gl!.updateMask(mask);
        } finally {
          result.close();
        }
      });
      this.gl.renderFrame(frame);
      const output = new VideoFrame(canvas, { timestamp: frame.timestamp });
      controller.enqueue(output);
      const processingTimeMs = performance.now() - started;
      this.options.onFrameProcessed?.({
        processingTimeMs,
        segmentationTimeMs: this.segmentationTimeMs,
        filterTimeMs: processingTimeMs - this.segmentationTimeMs,
      });
    } finally {
      if (!forwarded) frame.close();
    }
  }

  override async destroy(options?: TrackTransformerDestroyOptions) {
    this.maskFilter?.destroy();
    this.maskFilter = undefined;
    await super.destroy(options);
  }
}

export class StableBackgroundProcessor extends BackgroundProcessorWrapper {
  private generation?: BackgroundProcessorWrapper;

  constructor(
    options: BackgroundOptions,
    private readonly maxFrameRate: number,
    readonly foregroundMode: CameraForegroundMode,
  ) {
    super(
      new StableBackgroundTransformer(
        foregroundMode === "person-only"
          ? { ...options, assetPaths: { ...options.assetPaths, modelAssetPath: personModel } }
          : options,
        foregroundMode,
      ),
      "studio-background",
      { maxFps: maxFrameRate },
    );
  }

  override async restart(options: ProcessorOptions<Track.Kind>) {
    const settings = { ...this.transformer.options };
    await this.destroy({ willProcessorRestart: true });
    // The SDK's old stream can finish after restart and call cleanup on its wrapper.
    // Give every restarted stream its own wrapper so late cleanup cannot stop new video.
    const generation = new BackgroundProcessorWrapper(
      new StableBackgroundTransformer(settings, this.foregroundMode),
      this.name,
      { maxFps: this.maxFrameRate },
    );
    await generation.init(options);
    this.generation = generation;
    this.transformer = generation.transformer;
    this.processedTrack = generation.processedTrack;
    this.source = generation.source;
    this.sourceDummy = generation.sourceDummy;
  }

  override async updateTransformerOptions(options: BackgroundOptions) {
    if (this.generation) await this.generation.updateTransformerOptions(options);
    else await super.updateTransformerOptions(options);
  }

  override async destroy(
    options: TrackTransformerDestroyOptions = { willProcessorRestart: false },
  ) {
    if (this.generation) {
      const generation = this.generation;
      this.generation = undefined;
      await generation.destroy(options);
    } else await super.destroy(options);
  }
}

export function stableBackgroundProcessor(
  options: BackgroundOptions,
  maxFps: number,
  foregroundMode: CameraForegroundMode = "stable",
) {
  return new StableBackgroundProcessor(options, maxFps, foregroundMode);
}
