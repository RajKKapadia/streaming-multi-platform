import { describe, expect, test } from "bun:test";
import { VoiceDsp } from "../src/voice-dsp";
import {
  defaultVoiceSettings,
  matchingVoicePreset,
  voicePresets,
  voiceSettings,
  type VoiceSettings,
} from "../src/voice-settings";

describe("voice preset selection", () => {
  test("restores the selected preset from saved settings, including while bypassed", () => {
    for (const preset of voicePresets) {
      const saved = voiceSettings(JSON.parse(JSON.stringify(preset.settings)));
      expect(matchingVoicePreset(saved)).toBe(preset.id);
      expect(matchingVoicePreset({ ...saved, enabled: false })).toBe(preset.id);
    }
  });
  test("manual tone, dynamics, and cleanup changes are shown as custom settings", () => {
    const preset = voicePresets[1].settings;
    for (const patch of [
      { warmth: 3 },
      { gain: -2 },
      { noiseReduction: false },
      { levelingAmount: 1.5 },
    ])
      expect(matchingVoicePreset({ ...preset, ...patch })).toBe("");
    expect(matchingVoicePreset(defaultVoiceSettings)).toBe("");
  });
  test("older saved settings get gentle normalization without changing tone or bypass", () => {
    const { levelingAmount: _, ...saved } = voicePresets[1].settings;
    const restored = voiceSettings({ ...saved, enabled: false });
    expect(restored.levelingAmount).toBe(3);
    expect(restored.warmth).toBe(saved.warmth);
    expect(restored.enabled).toBe(false);
    expect(matchingVoicePreset(restored)).toBe("warm");
    expect(voiceSettings({ levelingAmount: 100 }).levelingAmount).toBe(6);
    expect(voiceSettings({ levelingAmount: -5 }).levelingAmount).toBe(0);
    expect(voiceSettings({ levelingAmount: NaN }).levelingAmount).toBe(3);
  });
});

const rate = 48000;
const rms = (samples: Float32Array) =>
  Math.sqrt(samples.reduce((sum, x) => sum + x * x, 0) / samples.length);
const level = (samples: Float32Array) => 20 * Math.log10(Math.max(1e-12, rms(samples)));
function tone(hz: number, gain: number, seconds = 2) {
  return Float32Array.from(
    { length: rate * seconds },
    (_, i) => gain * Math.sin((2 * Math.PI * hz * i) / rate),
  );
}
const neutral = {
  ...defaultVoiceSettings,
  enabled: true,
  expander: false,
  compression: 1,
  leveling: false,
  warmth: 0,
  clarity: 0,
  deEss: 0,
};
function render(input: Float32Array, settings: Partial<VoiceSettings> = {}) {
  const output = new Float32Array(input.length),
    dsp = new VoiceDsp({ ...neutral, ...settings });
  for (let i = 0; i < input.length; i += 128)
    dsp.process(input.subarray(i, i + 128), output.subarray(i, i + 128));
  return { output, dsp };
}

describe("live voice PCM", () => {
  test("low rumble is removed while the speech band survives", () => {
    const low = render(tone(30, 0.1)).output.slice(rate);
    const voice = render(tone(1000, 0.1)).output.slice(rate);
    expect(level(low)).toBeLessThan(level(voice) - 15);
    expect(level(voice)).toBeGreaterThan(-25);
  });
  test("warmth adds body without boosting sub-bass", () => {
    const input = tone(180, 0.1);
    const flat = render(input).output.slice(rate);
    const warm = render(input, { warmth: 2 }).output.slice(rate);
    expect(level(warm) - level(flat)).toBeGreaterThan(1.8);
    expect(level(warm) - level(flat)).toBeLessThan(2.2);
  });
  test("expansion reduces quiet backgrounds and preserves normal speech", () => {
    const noise = tone(1000, 0.001),
      speech = tone(1000, 0.1);
    expect(level(render(noise, { expander: true }).output.slice(rate))).toBeLessThan(
      level(render(noise).output.slice(rate)) - 15,
    );
    expect(
      Math.abs(
        level(render(speech, { expander: true }).output.slice(rate)) -
          level(render(speech).output.slice(rate)),
      ),
    ).toBeLessThan(0.2);
  });
  test("compression reduces loud/quiet speech differences", () => {
    const difference = (compression: number) =>
      level(render(tone(1000, 0.5), { compression }).output.slice(rate)) -
      level(render(tone(1000, 0.05), { compression }).output.slice(rate));
    expect(difference(3)).toBeLessThan(difference(1) - 5);
  });
  test("de-essing reduces sibilance more than lower speech frequencies", () => {
    const loss = (hz: number) =>
      level(render(tone(hz, 0.2), { deEss: 6 }).output.slice(rate)) -
      level(render(tone(hz, 0.2)).output.slice(rate));
    expect(loss(7500)).toBeLessThan(-3);
    expect(Math.abs(loss(1000))).toBeLessThan(0.5);
  });
  test("leveling approaches its target and does not raise gain during noise or silence", () => {
    const { dsp } = render(tone(1000, 0.04, 10), {
      leveling: true,
      levelingAmount: 6,
      targetLufs: -23,
    });
    const before = dsp.meters();
    expect(before.levelGainDb).toBeGreaterThan(2);
    expect(before.loudness).toBeGreaterThan(-27);
    const noise = tone(1000, 0.0001, 4),
      out = new Float32Array(noise.length);
    dsp.process(noise, out);
    expect(dsp.meters().levelGainDb).toBeCloseTo(before.levelGainDb, 1);
    dsp.process(new Float32Array(rate), new Float32Array(rate));
    expect(dsp.meters().levelGainDb).toBeCloseTo(before.levelGainDb, 1);
  });
  test("gentle normalization lifts quiet speech and softens loud speech within 3 dB", () => {
    const quiet = render(tone(1000, 0.04, 12), { leveling: true, targetLufs: -23 });
    const loud = render(tone(1000, 0.4, 12), { leveling: true, targetLufs: -23 });
    expect(quiet.dsp.meters().levelGainDb).toBeGreaterThan(2.5);
    expect(quiet.dsp.meters().levelGainDb).toBeLessThanOrEqual(3);
    expect(loud.dsp.meters().levelGainDb).toBeLessThan(-2.5);
    expect(loud.dsp.meters().levelGainDb).toBeGreaterThanOrEqual(-3);
    const difference = level(loud.output.slice(-rate)) - level(quiet.output.slice(-rate));
    expect(difference).toBeLessThan(15);
    expect(difference).toBeGreaterThan(13);
  });
  test("normalization amount updates during pauses and zero or bypass removes correction", () => {
    for (const gain of [0.04, 0.4]) {
      const settings = { ...neutral, leveling: true, targetLufs: -23 };
      const { dsp } = render(tone(1000, gain, 12), settings);
      const silence = new Float32Array(rate * 4);
      const out = new Float32Array(silence.length);
      dsp.update({ ...settings, levelingAmount: 1 });
      dsp.process(silence, out);
      expect(Math.abs(dsp.meters().levelGainDb)).toBeCloseTo(1, 2);
      dsp.update({ ...settings, levelingAmount: 0 });
      dsp.process(silence, out);
      expect(Math.abs(dsp.meters().levelGainDb)).toBeLessThan(0.001);
      dsp.update(settings);
      const speech = tone(1000, gain, 12);
      dsp.process(speech, new Float32Array(speech.length));
      expect(Math.abs(dsp.meters().levelGainDb)).toBeGreaterThan(2.5);
      dsp.update({ ...settings, leveling: false });
      dsp.process(silence, out);
      expect(Math.abs(dsp.meters().levelGainDb)).toBeLessThan(0.001);
    }
    const input = tone(1000, 0.04);
    const zero = render(input, { leveling: true, levelingAmount: 0 }).output;
    expect(zero).toEqual(render(input, { leveling: false }).output);
  });
  test("lookahead limiter catches impulses and sustained overload at every supported ceiling", () => {
    const input = tone(1000, 4);
    for (let i = 13; i < input.length; i += 777) input[i] = 8;
    for (const ceiling of [-6, -3, -1]) {
      const { output } = render(input, { ceiling, gain: 6 });
      let peak = 0;
      expect(output.every(Number.isFinite)).toBe(true);
      for (const sample of output) peak = Math.max(peak, Math.abs(sample));
      expect(peak).toBeLessThanOrEqual(10 ** (ceiling / 20) + 1e-7);
      expect(peak).toBeGreaterThan(0.3);
    }
  });
  test("invalid samples and saved settings cannot produce non-finite output", () => {
    const settings = voiceSettings({
      warmth: Number.NaN,
      gain: Infinity,
      compression: -40,
      ceiling: 20,
    });
    expect(settings.warmth).toBe(defaultVoiceSettings.warmth);
    expect(settings.compression).toBe(1);
    expect(settings.ceiling).toBe(-1);
    const input = tone(1000, 0.1, 1);
    input[100] = NaN;
    input[200] = Infinity;
    expect(render(input, settings).output.every(Number.isFinite)).toBe(true);
  });
});
