import { type AudioCaptureOptions, type LocalAudioTrack } from "livekit-client";
import { usePreferences } from "./store";
import { VoiceProcessor } from "./voice-processor";
import { voiceSettings } from "./voice-settings";

const pending = new WeakMap<LocalAudioTrack, Promise<void>>();
export const voiceErrors = new WeakMap<LocalAudioTrack, string>();

export function microphoneOptions(browserCleanup = false): AudioCaptureOptions {
  const p = usePreferences.getState();
  const enabled = voiceSettings(p.voice).enabled && !browserCleanup;
  return {
    deviceId: p.microphoneId || undefined,
    echoCancellation: p.echo,
    noiseSuppression: !enabled,
    autoGainControl: !enabled,
    channelCount: 1,
    sampleRate: 48000,
  };
}

async function restoreBrowserAudio(track: LocalAudioTrack, message: string) {
  voiceErrors.set(track, message);
  if (track.getProcessor()) await track.stopProcessor();
  // User-provided tracks include synthetic checks; never acquire a microphone on their behalf.
  if (!track.isUserProvided && track.mediaStreamTrack.readyState === "live")
    await track.restartTrack(microphoneOptions(true));
}

export function applyMicrophoneEffect(track: LocalAudioTrack): Promise<void> {
  const task = (pending.get(track) ?? Promise.resolve())
    .catch(() => {})
    .then(async () => {
      const settings = voiceSettings(usePreferences.getState().voice);
      const previous = track.getProcessor();
      if (!previous && track.mediaStreamTrack.readyState === "ended") return;
      voiceErrors.delete(track);
      if (!settings.enabled) {
        const raw = track.getSourceTrackSettings();
        const needsCleanup =
          previous || raw.autoGainControl === false || raw.noiseSuppression === false;
        if (previous) await track.stopProcessor();
        if (needsCleanup && !track.isUserProvided && track.mediaStreamTrack.readyState === "live")
          await track.restartTrack(microphoneOptions());
        return;
      }
      if (
        previous instanceof VoiceProcessor &&
        previous.noiseReduction === settings.noiseReduction
      ) {
        previous.update(settings);
        return;
      }
      let processor: VoiceProcessor | undefined;
      try {
        if (previous) await track.stopProcessor();
        const raw = track.getSourceTrackSettings();
        if (!track.isUserProvided && (raw.autoGainControl || raw.noiseSuppression))
          await track.restartTrack(microphoneOptions());
        processor = new VoiceProcessor(settings, (message) => {
          // Run outside the SDK's processor callback and serialize against settings/device changes.
          const fallback = (pending.get(track) ?? Promise.resolve())
            .catch(() => {})
            .then(() => {
              if (track.getProcessor() === processor) return restoreBrowserAudio(track, message);
            })
            .catch(() => {
              voiceErrors.set(track, `${message} Reselect your microphone if it is silent.`);
            });
          pending.set(track, fallback);
        });
        track.setAudioContext(processor.context);
        await track.setProcessor(processor);
        // A user can leave while model/worklet loading is in flight. Never retain that graph
        // or reacquire a stopped microphone after the SDK's synchronous track.stop().
        if (processor.inputTrack?.readyState === "ended") await track.stopProcessor();
      } catch (error) {
        await processor?.destroy();
        await restoreBrowserAudio(
          track,
          `${error instanceof Error ? error.message : "Voice processing could not start."} Using browser microphone cleanup.`,
        );
      }
    });
  pending.set(track, task);
  return task;
}
