import { voiceSettings, type VoiceSettings, type VoiceMeters } from "./voice-settings";

const db = (v: number) => 20 * Math.log10(Math.max(1e-6, v));
const amplitude = (v: number) => 10 ** (v / 20);
const coefficient = (ms: number, rate: number) => Math.exp(-1 / (ms * 0.001 * rate));
const follow = (value: number, target: number, c: number) => target + c * (value - target);

// Transposed direct form II. Coefficients follow the Audio EQ Cookbook.
class Biquad {
  private z1 = 0;
  private z2 = 0;
  constructor(
    private b: number[],
    private a: number[],
  ) {}
  process(x: number) {
    const y = this.b[0] * x + this.z1;
    this.z1 = this.b[1] * x - this.a[1] * y + this.z2;
    this.z2 = this.b[2] * x - this.a[2] * y;
    return y;
  }
  static make(type: "highpass" | "peak", hz: number, q: number, gain: number, rate: number) {
    const w = (2 * Math.PI * hz) / rate,
      c = Math.cos(w),
      alpha = Math.sin(w) / (2 * q);
    const A = 10 ** (gain / 40);
    const b =
      type === "highpass"
        ? [(1 + c) / 2, -(1 + c), (1 + c) / 2]
        : [1 + alpha * A, -2 * c, 1 - alpha * A];
    const a =
      type === "highpass" ? [1 + alpha, -2 * c, 1 - alpha] : [1 + alpha / A, -2 * c, 1 - alpha / A];
    return new Biquad(
      b.map((v) => v / a[0]),
      a.map((v) => v / a[0]),
    );
  }
}

// BS.1770 K weighting at 48 kHz. The graph requires 48 kHz, including on input resampling.
function kWeight() {
  const shelf = new Biquad(
    [1.53512485958697, -2.69169618940638, 1.19839281085285],
    [1, -1.69065929318241, 0.73248077421585],
  );
  const highPass = new Biquad([1, -2, 1], [1, -1.99004745483398, 0.99007225036621]);
  return (x: number) => highPass.process(shelf.process(x));
}

/** Mono spoken-voice DSP shared by the AudioWorklet and deterministic PCM tests. */
export class VoiceDsp {
  private settings: VoiceSettings;
  private filters: Biquad[] = [];
  private sibilance: Biquad;
  private inputWeight = kWeight();
  private outputWeight = kWeight();
  private energy = 0;
  private highEnergy = 0;
  private levelEnergy = 0;
  private outputEnergy = 0;
  private expansion = 1;
  private compression = 1;
  private deEssGain = 1;
  private levelGain = 0;
  private outputGain = 1;
  private limiter = 1;
  private clock = 0;
  private peakIn = 0;
  private peakOut = 0;
  readonly latencySamples: number;
  private delay: Float32Array;
  private peaks: Float64Array;
  private peakTimes: Float64Array;
  private head = 0;
  private tail = 0;
  private rmsC: number;
  private levelC: number;
  private openC: number;
  private closeC: number;
  private attackC: number;
  private releaseC: number;
  private boostC: number;
  private attenuateC: number;
  private limiterC: number;
  constructor(
    settings: VoiceSettings,
    readonly sampleRate = 48000,
  ) {
    if (sampleRate !== 48000) throw new Error("Voice processing requires a 48 kHz context.");
    this.settings = voiceSettings(settings);
    this.sibilance = Biquad.make("highpass", 4500, 0.707, 0, sampleRate);
    this.latencySamples = Math.round(sampleRate * 0.005);
    this.delay = new Float32Array(this.latencySamples);
    this.peaks = new Float64Array(this.latencySamples + 2);
    this.peakTimes = new Float64Array(this.peaks.length);
    this.rmsC = coefficient(10, sampleRate);
    this.levelC = coefficient(400, sampleRate);
    this.openC = coefficient(5, sampleRate);
    this.closeC = coefficient(120, sampleRate);
    this.attackC = coefficient(10, sampleRate);
    this.releaseC = coefficient(150, sampleRate);
    this.boostC = coefficient(4000, sampleRate);
    this.attenuateC = coefficient(400, sampleRate);
    this.limiterC = coefficient(60, sampleRate);
    this.update(settings);
  }
  update(settings: VoiceSettings) {
    const next = voiceSettings(settings),
      old = this.settings;
    if (
      !this.filters.length ||
      old.highPass !== next.highPass ||
      old.warmth !== next.warmth ||
      old.clarity !== next.clarity
    ) {
      this.filters = [
        Biquad.make("highpass", next.highPass, 0.707, 0, this.sampleRate),
        Biquad.make("peak", 180, 0.8, next.warmth, this.sampleRate),
        Biquad.make("peak", 350, 1, -1.5, this.sampleRate),
        Biquad.make("peak", 3000, 0.8, next.clarity, this.sampleRate),
      ];
    }
    this.settings = next;
  }
  process(input: Float32Array, output: Float32Array) {
    const p = this.settings,
      ceiling = amplitude(p.ceiling);
    for (let i = 0; i < output.length; i++) {
      let x = Number.isFinite(input[i]) ? input[i] : 0;
      this.peakIn = Math.max(this.peakIn, Math.abs(x));
      for (const filter of this.filters) x = filter.process(x);
      this.energy = follow(this.energy, x * x, this.rmsC);
      const rmsDb = db(Math.sqrt(this.energy));
      const expansion = p.expander
        ? amplitude(Math.max(-18, Math.min(0, (rmsDb - p.noiseFloor) * 1.5)))
        : 1;
      this.expansion = follow(
        this.expansion,
        expansion,
        expansion > this.expansion ? this.openC : this.closeC,
      );
      x *= this.expansion;

      const high = this.sibilance.process(x);
      this.highEnergy = follow(this.highEnergy, high * high, this.rmsC);
      const highDb = db(Math.sqrt(this.highEnergy));
      const essReduction =
        highDb > -36 && this.highEnergy > this.energy * 0.2
          ? Math.min(p.deEss, Math.max(0, (highDb + 36) * 0.5))
          : 0;
      this.deEssGain = follow(
        this.deEssGain,
        amplitude(-essReduction),
        essReduction > 0 ? this.openC : this.releaseC,
      );
      // Broadband de-essing avoids phase cancellation from recombining a filtered band.
      // It engages only when high-frequency energy dominates the voice signal.
      x *= this.deEssGain;

      const over = db(Math.abs(x)) - p.threshold,
        knee = 6;
      const reduction =
        over < -knee / 2
          ? 0
          : over > knee / 2
            ? over * (1 - 1 / p.compression)
            : ((1 - 1 / p.compression) * (over + knee / 2) ** 2) / (2 * knee);
      const compress = amplitude(-reduction);
      this.compression = follow(
        this.compression,
        compress,
        compress < this.compression ? this.attackC : this.releaseC,
      );
      x *= this.compression;

      const weighted = this.inputWeight(x);
      this.levelEnergy = follow(this.levelEnergy, weighted * weighted, this.levelC);
      const loudness = -0.691 + 10 * Math.log10(Math.max(1e-12, this.levelEnergy));
      // Freeze during pauses. Bounded, slow gain changes avoid chasing room noise or one syllable.
      if (
        p.leveling &&
        this.clock > this.sampleRate * 0.4 &&
        rmsDb > p.noiseFloor + 8 &&
        loudness > -45
      ) {
        const target = Math.max(-12, Math.min(6, p.targetLufs - loudness));
        this.levelGain = follow(
          this.levelGain,
          target,
          target < this.levelGain ? this.attenuateC : this.boostC,
        );
      } else if (!p.leveling) this.levelGain = follow(this.levelGain, 0, this.attenuateC);
      this.outputGain = follow(this.outputGain, amplitude(this.levelGain + p.gain), this.openC);
      x *= this.outputGain;

      // Monotonic queue finds the peak across the complete 5 ms lookahead window in O(1).
      const size = this.peaks.length;
      while (
        this.head !== this.tail &&
        this.peakTimes[this.head] < this.clock - this.latencySamples
      )
        this.head = (this.head + 1) % size;
      while (this.head !== this.tail && this.peaks[(this.tail - 1 + size) % size] <= Math.abs(x))
        this.tail = (this.tail - 1 + size) % size;
      this.peaks[this.tail] = Math.abs(x);
      this.peakTimes[this.tail] = this.clock;
      this.tail = (this.tail + 1) % size;
      const targetLimit = Math.min(1, ceiling / Math.max(1e-9, this.peaks[this.head]));
      this.limiter =
        targetLimit < this.limiter ? targetLimit : follow(this.limiter, targetLimit, this.limiterC);
      const index = this.clock % this.delay.length;
      const delayed = this.delay[index];
      this.delay[index] = x;
      const y = Math.max(-ceiling, Math.min(ceiling, delayed * this.limiter));
      output[i] = y;
      this.peakOut = Math.max(this.peakOut, Math.abs(y));
      const weightedOutput = this.outputWeight(y);
      this.outputEnergy = follow(this.outputEnergy, weightedOutput * weightedOutput, this.levelC);
      this.clock++;
    }
  }
  meters(): VoiceMeters {
    const result = {
      inputDb: db(this.peakIn),
      outputDb: db(this.peakOut),
      loudness: Math.max(-100, -0.691 + 10 * Math.log10(Math.max(1e-12, this.outputEnergy))),
      compressionDb: -db(this.compression),
      deEssDb: -db(this.deEssGain),
      levelGainDb: this.levelGain,
    };
    this.peakIn = this.peakOut = 0;
    return result;
  }
}
