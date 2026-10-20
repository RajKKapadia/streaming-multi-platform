export type VoiceSettings = {
  enabled: boolean;
  noiseReduction: boolean;
  expander: boolean;
  noiseFloor: number;
  highPass: number;
  warmth: number;
  clarity: number;
  deEss: number;
  compression: number;
  threshold: number;
  leveling: boolean;
  targetLufs: number;
  gain: number;
  ceiling: number;
};

export const defaultVoiceSettings: VoiceSettings = {
  enabled: false,
  noiseReduction: true,
  expander: true,
  noiseFloor: -45,
  highPass: 75,
  warmth: 1.5,
  clarity: 1,
  deEss: 4,
  compression: 2.5,
  threshold: -18,
  leveling: true,
  targetLufs: -16,
  gain: 0,
  ceiling: -3,
};

export const voicePresets = [
  {
    id: "natural",
    label: "Natural speech",
    settings: { ...defaultVoiceSettings, enabled: true, warmth: 1, clarity: 1 },
  },
  {
    id: "warm",
    label: "Warm broadcast voice",
    settings: { ...defaultVoiceSettings, enabled: true, warmth: 2, clarity: 0.5 },
  },
] as const;

export function matchingVoicePreset(value: VoiceSettings): string {
  return (
    voicePresets.find(({ settings }) =>
      (Object.keys(settings) as (keyof VoiceSettings)[]).every(
        (key) => key === "enabled" || value[key] === settings[key],
      ),
    )?.id ?? ""
  );
}

export function voiceSettings(value: Partial<VoiceSettings> = {}): VoiceSettings {
  if (!value || typeof value !== "object") value = {};
  const result = { ...defaultVoiceSettings };
  for (const key of ["enabled", "noiseReduction", "expander", "leveling"] as const)
    if (typeof value[key] === "boolean") result[key] = value[key];
  const ranges = {
    noiseFloor: [-65, -25],
    highPass: [40, 140],
    warmth: [-3, 4],
    clarity: [-3, 3],
    deEss: [0, 8],
    compression: [1, 4],
    threshold: [-30, -6],
    targetLufs: [-23, -14],
    gain: [-12, 6],
    ceiling: [-6, -1],
  } as const;
  for (const key of Object.keys(ranges) as (keyof typeof ranges)[]) {
    const v = value[key];
    if (typeof v === "number" && Number.isFinite(v))
      result[key] = Math.max(ranges[key][0], Math.min(ranges[key][1], v));
  }
  return result;
}

export type VoiceMeters = {
  inputDb: number;
  outputDb: number;
  loudness: number;
  compressionDb: number;
  deEssDb: number;
  levelGainDb: number;
};
