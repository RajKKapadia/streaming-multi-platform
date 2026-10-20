import { VoiceDsp } from "./voice-dsp";
import type { VoiceSettings } from "./voice-settings";

declare const sampleRate: number;
declare class AudioWorkletProcessor {
  port: MessagePort;
  constructor(options?: unknown);
}
declare function registerProcessor(name: string, processor: typeof AudioWorkletProcessor): void;

class VoiceWorklet extends AudioWorkletProcessor {
  private dsp: VoiceDsp;
  private frames = 0;
  private stopped = false;
  private silence = new Float32Array(128);
  constructor(options: { processorOptions: VoiceSettings }) {
    super();
    this.dsp = new VoiceDsp(options.processorOptions, sampleRate);
    this.port.onmessage = ({ data }) => {
      if (data === "stop") this.stopped = true;
      else if (data?.reset) this.dsp = new VoiceDsp(data.reset, sampleRate);
      else this.dsp.update(data);
    };
    this.port.postMessage("ready");
  }
  process(inputs: Float32Array[][], outputs: Float32Array[][]) {
    if (this.stopped) return false;
    const output = outputs[0]?.[0];
    if (output) this.dsp.process(inputs[0]?.[0] ?? this.silence, output);
    if (++this.frames % 40 === 0) this.port.postMessage(this.dsp.meters());
    return true;
  }
}
registerProcessor("studio-voice", VoiceWorklet as typeof AudioWorkletProcessor);
