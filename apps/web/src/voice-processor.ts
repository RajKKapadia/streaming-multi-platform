import { Track, type AudioProcessorOptions, type TrackProcessor } from "livekit-client";
import { RnnoiseWorkletNode, loadRnnoise } from "@sapphi-red/web-noise-suppressor";
import rnnoiseUrl from "@sapphi-red/web-noise-suppressor/rnnoiseWorklet.js?url";
import wasmUrl from "@sapphi-red/web-noise-suppressor/rnnoise.wasm?url";
import simdUrl from "@sapphi-red/web-noise-suppressor/rnnoise_simd.wasm?url";
import workletUrl from "./voice-worklet.ts?worker&url";
import { voiceSettings, type VoiceSettings, type VoiceMeters } from "./voice-settings";

export async function within<T>(promise: Promise<T>, ms = 8000): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Voice processing took too long to start.")), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer!);
  }
}

let binary: Promise<ArrayBuffer> | undefined;
const noiseBinary = () => {
  binary ??= loadRnnoise({ url: wasmUrl, simdUrl }, { signal: AbortSignal.timeout(8000) })
    .then(async (bytes) => {
      // A stale or missing asset must fail before replacing a working microphone track.
      await WebAssembly.compile(bytes);
      return bytes;
    })
    .catch((error) => {
      binary = undefined;
      throw error;
    });
  return binary;
};

/** Owns its 48 kHz context so a LiveKit disconnect cannot close the microphone's DSP. */
export class VoiceProcessor implements TrackProcessor<Track.Kind.Audio, AudioProcessorOptions> {
  readonly name = "Studio voice";
  readonly context = new AudioContext({ sampleRate: 48000, latencyHint: "interactive" });
  processedTrack?: MediaStreamTrack;
  inputTrack?: MediaStreamTrack;
  meters?: VoiceMeters;
  warning = "";
  private source?: MediaStreamAudioSourceNode;
  private destination?: MediaStreamAudioDestinationNode;
  private node?: AudioWorkletNode;
  private noise?: RnnoiseWorkletNode;
  private settings: VoiceSettings;
  private disposed = false;
  private generation = 0;
  constructor(
    settings: VoiceSettings,
    private onFailure: (error: string) => void = () => {},
  ) {
    this.settings = voiceSettings(settings);
  }
  async init({ track }: AudioProcessorOptions) {
    this.inputTrack = track;
    const generation = ++this.generation;
    await within(this.context.resume(), 2000);
    if (this.context.sampleRate !== 48000 || this.context.state !== "running")
      throw new Error("Live voice processing needs a running 48 kHz audio context.");
    await within(
      Promise.all([
        this.context.audioWorklet.addModule(workletUrl),
        ...(this.settings.noiseReduction
          ? [this.context.audioWorklet.addModule(rnnoiseUrl), noiseBinary()]
          : []),
      ]),
    );
    if (this.disposed || generation !== this.generation)
      throw new Error("Microphone processing was stopped.");
    this.source = this.context.createMediaStreamSource(new MediaStream([track]));
    this.destination = this.context.createMediaStreamDestination();
    this.node = new AudioWorkletNode(this.context, "studio-voice", {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      channelCount: 1,
      channelCountMode: "explicit",
      processorOptions: this.settings,
    });
    this.node.addEventListener("processorerror", () =>
      this.fail("Voice processing stopped; browser microphone cleanup is being restored."),
    );
    await within(
      new Promise<void>((resolve) => {
        this.node!.port.onmessage = ({ data }) => {
          if (data === "ready") resolve();
          else this.meters = data;
        };
      }),
      2000,
    );
    if (this.disposed || generation !== this.generation)
      throw new Error("Microphone processing was stopped.");
    if (this.settings.noiseReduction) {
      this.noise = new RnnoiseWorkletNode(this.context, {
        wasmBinary: await noiseBinary(),
        maxChannels: 1,
      });
      this.noise.addEventListener("processorerror", () =>
        this.fail("Noise removal stopped; browser microphone cleanup is being restored."),
      );
      this.source.connect(this.noise).connect(this.node);
    } else this.source.connect(this.node);
    this.node.connect(this.destination);
    this.processedTrack = this.destination.stream.getAudioTracks()[0];
  }
  update(settings: VoiceSettings) {
    this.settings = voiceSettings(settings);
    this.node?.port.postMessage(this.settings);
  }
  get noiseReduction() {
    return this.settings.noiseReduction;
  }
  private fail(message: string) {
    if (this.disposed || this.warning) return;
    this.warning = message;
    this.onFailure(message);
  }
  // The SDK omits audioContext on restart; keep ours and reconnect only the new raw source.
  async restart({ track }: AudioProcessorOptions) {
    if (this.disposed || !this.node) throw new Error("Voice processing is no longer active.");
    this.source?.disconnect();
    this.inputTrack = track;
    this.source = this.context.createMediaStreamSource(new MediaStream([track]));
    this.source.connect(this.noise ?? this.node);
    this.node.port.postMessage({ reset: this.settings });
    await within(this.context.resume(), 2000);
  }
  async destroy() {
    if (this.disposed) return;
    this.disposed = true;
    this.generation++;
    this.source?.disconnect();
    this.noise?.destroy();
    this.noise?.disconnect();
    this.node?.port.postMessage("stop");
    this.node?.disconnect();
    this.node?.port.close();
    this.destination?.disconnect();
    this.processedTrack?.stop();
    this.processedTrack = undefined;
    this.inputTrack = undefined;
    await this.context.close().catch(() => {});
  }
}
