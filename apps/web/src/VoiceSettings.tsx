import { useEffect, useRef, useState } from "react";
import { type LocalAudioTrack } from "livekit-client";
import { Button, Select, Switch } from "@studio/ui";
import { usePreferences } from "./store";
import {
  matchingVoicePreset,
  voicePresets,
  voiceSettings,
  type VoiceSettings as Settings,
  type VoiceMeters,
} from "./voice-settings";
import { VoiceProcessor } from "./voice-processor";
import { voiceErrors } from "./voice";

export function VoiceSettings({ microphone }: { microphone?: LocalAudioTrack }) {
  const preferences = usePreferences();
  const p = voiceSettings(preferences.voice);
  const set = (patch: Partial<Settings>) =>
    preferences.set({ voice: voiceSettings({ ...p, ...patch }) });
  const [status, setStatus] = useState("Enable your microphone to try voice processing.");
  const [meters, setMeters] = useState<VoiceMeters>();
  const [recording, setRecording] = useState(false);
  const [samples, setSamples] = useState<{ label: string; url: string }[]>([]);
  const [testError, setTestError] = useState("");
  const recorder = useRef<
    { recorders: MediaRecorder[]; timer: ReturnType<typeof setTimeout> } | undefined
  >(undefined);
  const urls = useRef<string[]>([]);
  useEffect(() => {
    const update = () => {
      const processor = microphone?.getProcessor();
      const error = microphone && voiceErrors.get(microphone);
      setStatus(
        !microphone
          ? "Enable your microphone to try voice processing."
          : error ||
              (processor instanceof VoiceProcessor
                ? processor.warning || "Live voice processing is active."
                : p.enabled
                  ? "Starting voice processing…"
                  : "Voice processing is bypassed. Browser cleanup is active."),
      );
      setMeters(processor instanceof VoiceProcessor ? processor.meters : undefined);
    };
    update();
    const timer = setInterval(update, 200);
    return () => clearInterval(timer);
  }, [microphone, p.enabled]);
  useEffect(
    () => () => {
      if (recorder.current) {
        clearTimeout(recorder.current.timer);
        for (const r of recorder.current.recorders) {
          r.onstop = null;
          if (r.state !== "inactive") r.stop();
        }
      }
      for (const url of urls.current) URL.revokeObjectURL(url);
    },
    [],
  );
  const record = () => {
    if (!microphone || microphone.isMuted || recording) return;
    setTestError("");
    for (const url of urls.current) URL.revokeObjectURL(url);
    urls.current = [];
    setSamples([]);
    const recorders: MediaRecorder[] = [];
    try {
      if (typeof MediaRecorder === "undefined")
        throw new Error("Audio recording is unavailable in this browser.");
      const processor = microphone.getProcessor();
      const inputs =
        processor instanceof VoiceProcessor && processor.inputTrack
          ? [
              { label: "Before voice processing", track: processor.inputTrack },
              { label: "After voice processing", track: microphone.mediaStreamTrack },
            ]
          : [{ label: "Microphone sample", track: microphone.mediaStreamTrack }];
      for (const input of inputs) {
        const chunks: Blob[] = [];
        const r = new MediaRecorder(new MediaStream([input.track]));
        r.ondataavailable = ({ data }) => {
          if (data.size) chunks.push(data);
        };
        r.onerror = () => setTestError("The microphone sample could not be recorded.");
        r.onstop = () => {
          if (!chunks.length) return;
          const url = URL.createObjectURL(new Blob(chunks, { type: r.mimeType }));
          urls.current.push(url);
          setSamples((previous) => [...previous, { label: input.label, url }]);
        };
        r.start();
        recorders.push(r);
      }
      setRecording(true);
      recorder.current = {
        recorders,
        timer: setTimeout(() => {
          for (const r of recorders) if (r.state !== "inactive") r.stop();
          recorder.current = undefined;
          setRecording(false);
        }, 8000),
      };
    } catch (error) {
      for (const r of recorders) {
        r.onstop = null;
        if (r.state !== "inactive") r.stop();
      }
      setRecording(false);
      setTestError(error instanceof Error ? error.message : "The audio test could not start.");
    }
  };
  const toggle = (key: "noiseReduction" | "expander" | "leveling", label: string) => (
    <div className="setting-line">
      <Switch
        checked={p[key]}
        onCheckedChange={(value) => set({ [key]: value })}
        label={label}
        disabled={!p.enabled || recording}
      />
      <span>{label}</span>
    </div>
  );
  const range = (
    key: keyof Settings,
    label: string,
    min: number,
    max: number,
    step: number,
    unit: string,
  ) => (
    <label className="voice-range">
      <span>
        {label}
        <output>
          {Number(p[key]).toFixed(step < 1 ? 1 : 0)} {unit}
        </output>
      </span>
      <input
        type="range"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={Number(p[key])}
        disabled={!p.enabled || recording}
        onChange={(e) => set({ [key]: Number(e.target.value) })}
      />
    </label>
  );
  return (
    <section className="voice-settings" aria-label="Live voice processing">
      <div className="setting-line">
        <Switch
          checked={p.enabled}
          onCheckedChange={(enabled) => set({ enabled })}
          label="Live voice processing"
          disabled={recording}
        />
        <strong>Live voice processing</strong>
      </div>
      <p className="hint">
        Clean up and polish your microphone before guests and viewers hear it. Voice controls apply
        immediately.
      </p>
      <p className="hint" role="status">
        {status}
      </p>
      <label>
        Voice preset
        <Select
          aria-label="Voice preset"
          value={matchingVoicePreset(p)}
          disabled={recording}
          onChange={(e) => {
            const preset = voicePresets.find(({ id }) => id === e.target.value);
            if (preset) preferences.set({ voice: { ...preset.settings } });
          }}
        >
          <option value="" disabled>
            Custom settings
          </option>
          {voicePresets.map(({ id, label }) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </Select>
      </label>
      {toggle("noiseReduction", "Fan and keyboard noise removal")}
      {toggle("expander", "Soften background noise between words")}
      {toggle("leveling", "Keep speech loudness consistent")}
      {meters && (
        <div className="voice-meters" aria-label="Processed microphone levels">
          <span>
            Input peak <strong>{Math.round(meters.inputDb)} dBFS</strong>
          </span>
          <span>
            Output peak <strong>{Math.round(meters.outputDb)} dBFS</strong>
          </span>
          <span>
            Live loudness{" "}
            <strong>
              {meters.loudness > -60 ? `${meters.loudness.toFixed(1)} LUFS` : "Quiet"}
            </strong>
          </span>
        </div>
      )}
      <details>
        <summary>Voice tone and dynamics</summary>
        {range("noiseFloor", "Background threshold", -65, -25, 1, "dBFS")}
        {range("highPass", "Remove low rumble below", 40, 140, 5, "Hz")}
        {range("warmth", "Warmth at 180 Hz", -3, 4, 0.5, "dB")}
        {range("clarity", "Clarity at 3 kHz", -3, 3, 0.5, "dB")}
        {range("deEss", "Maximum S-sound reduction", 0, 8, 0.5, "dB")}
        {range("compression", "Compression ratio", 1, 4, 0.5, ":1")}
        {range("threshold", "Compression threshold", -30, -6, 1, "dBFS")}
        {range("targetLufs", "Live loudness target", -23, -14, 1, "LUFS")}
        {range("gain", "Output trim", -12, 6, 0.5, "dB")}
        {range("ceiling", "Peak ceiling", -6, -1, 0.5, "dBFS")}
        <p className="hint">
          Live loudness is a rolling estimate. Quiet pauses hold the gain steady; a finished
          recording can still be normalized more precisely.
        </p>
      </details>
      <Button
        variant="secondary"
        disabled={!microphone || microphone.isMuted || recording}
        onClick={record}
      >
        {recording
          ? "Recording… speak and type for 8 seconds"
          : "Record an 8-second mic comparison"}
      </Button>
      <p className="hint">Samples stay in this browser. Use headphones for playback.</p>
      {testError && (
        <p role="alert" className="error">
          {testError}
        </p>
      )}
      {samples.map((sample) => (
        <label key={sample.url} className="voice-sample">
          {sample.label}
          <audio controls src={sample.url} aria-label={sample.label} />
        </label>
      ))}
    </section>
  );
}
