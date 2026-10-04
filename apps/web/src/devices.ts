import { useCallback, useEffect, useRef, useState } from "react";
import {
  createLocalTracks,
  LocalVideoTrack,
  LocalAudioTrack,
  Track,
  TrackEvent,
  type LocalTrack,
  type Room,
} from "livekit-client";
import { usePreferences } from "./store";
import type { Asset } from "@studio/contracts";
export function useCapture() {
  const [tracks, setTracks] = useState<LocalTrack[]>([]),
    [devices, setDevices] = useState<MediaDeviceInfo[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const enabling = useRef(false);
  const refresh = useCallback(
    async () => setDevices(await navigator.mediaDevices.enumerateDevices()),
    [],
  );
  useEffect(() => {
    void refresh().catch(() => {});
    navigator.mediaDevices?.addEventListener("devicechange", refresh);
    return () => navigator.mediaDevices?.removeEventListener("devicechange", refresh);
  }, [refresh]);
  const enable = async (channel?: "camera" | "microphone") => {
    if (enabling.current) return;
    enabling.current = true;
    setBusy(true);
    setError("");
    const p = usePreferences.getState();
    try {
      const retained = tracks.filter((t) => t.isMuted || t.mediaStreamTrack.readyState === "live");
      const camera = retained.find((t) => t.source === Track.Source.Camera);
      const microphone = retained.find((t) => t.source === Track.Source.Microphone);
      if (channel !== "microphone" && camera?.isMuted) await camera.unmute();
      if (channel !== "camera" && microphone?.isMuted) await microphone.unmute();
      const audio = channel !== "camera" && !microphone;
      const video = channel !== "microphone" && !camera;
      const ts =
        audio || video
          ? await createLocalTracks({
              audio: audio && {
                deviceId: p.microphoneId || undefined,
                echoCancellation: p.echo,
                noiseSuppression: true,
                autoGainControl: true,
              },
              video: video && {
                deviceId: p.cameraId || undefined,
                resolution: {
                  width: p.resolution === "1080" ? 1920 : p.resolution === "720" ? 1280 : 854,
                  height: Number(p.resolution),
                  frameRate: p.fps,
                },
              },
            })
          : [];
      tracks.filter((t) => !retained.includes(t)).forEach((t) => t.stop());
      setTracks([...retained, ...ts]);
      await refresh();
      return [...retained, ...ts].find((t): t is LocalVideoTrack => t instanceof LocalVideoTrack);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Camera and microphone could not start. Check your browser permissions.",
      );
    } finally {
      enabling.current = false;
      setBusy(false);
    }
  };
  return {
    tracks,
    setTracks,
    devices,
    error,
    setError,
    busy,
    enable,
    refresh,
    camera: tracks.find((t): t is LocalVideoTrack => t instanceof LocalVideoTrack),
    microphone: tracks.find((t): t is LocalAudioTrack => t instanceof LocalAudioTrack),
  };
}
export type Capture = ReturnType<typeof useCapture>;

export function useMicrophoneLevel(microphone?: LocalAudioTrack) {
  const [level, setLevel] = useState(0);
  useEffect(() => {
    setLevel(0);
    if (!microphone) return;
    const context = new AudioContext();
    const analyser = context.createAnalyser();
    analyser.fftSize = 2048;
    const samples = new Float32Array(analyser.fftSize);
    let source: MediaStreamAudioSourceNode | undefined;
    const bind = () => {
      source?.disconnect();
      source = context.createMediaStreamSource(new MediaStream([microphone.mediaStreamTrack]));
      source.connect(analyser);
    };
    bind();
    microphone.on(TrackEvent.Restarted, bind);
    const resume = () => {
      void context.resume().catch(() => {});
    };
    resume();
    window.addEventListener("pointerdown", resume);
    const timer = setInterval(() => {
      analyser.getFloatTimeDomainData(samples);
      const rms = Math.sqrt(
        samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length,
      );
      setLevel(microphone.isMuted ? 0 : Math.min(1, rms * 5));
    }, 80);
    return () => {
      clearInterval(timer);
      window.removeEventListener("pointerdown", resume);
      microphone.off(TrackEvent.Restarted, bind);
      source?.disconnect();
      void context.close();
    };
  }, [microphone]);
  return level;
}
export async function applyDevices(
  camera: LocalVideoTrack | undefined,
  mic: LocalAudioTrack | undefined,
  assets: Asset[],
) {
  const p = usePreferences.getState();
  const background =
    p.localBackground?.url ??
    assets.find((a) => a.id === p.backgroundId && a.category === "backgrounds")?.url;
  if (p.effect === "image" && !background)
    throw new Error("Choose a background image from your computer or the media library.");
  if (camera) {
    await camera.restartTrack({
      deviceId: p.cameraId || undefined,
      resolution: {
        width: p.resolution === "1080" ? 1920 : p.resolution === "720" ? 1280 : 854,
        height: Number(p.resolution),
        frameRate: p.fps,
      },
    });
    await camera.stopProcessor();
    if (p.effect !== "none") {
      const { BackgroundProcessor, supportsBackgroundProcessors } = await import(
        "@livekit/track-processors"
      );
      if (!supportsBackgroundProcessors())
        throw new Error("Camera effects are unavailable in this browser.");
      await camera.setProcessor(
        BackgroundProcessor(
          p.effect === "blur"
            ? { mode: "background-blur", blurRadius: 12 }
            : { mode: "virtual-background", imagePath: background! },
        ),
      );
    }
  }
  if (mic)
    await mic.restartTrack({
      deviceId: p.microphoneId || undefined,
      echoCancellation: p.echo,
      noiseSuppression: true,
      autoGainControl: true,
    });
}
export function useRoomUpdates(room: Room | null) {
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!room) return;
    const update = () => setRevision((v) => v + 1);
    const events = [
      "participantConnected",
      "participantDisconnected",
      "trackSubscribed",
      "trackUnsubscribed",
      "trackMuted",
      "trackUnmuted",
      "localTrackPublished",
      "localTrackUnpublished",
      "trackPublished",
      "trackUnpublished",
      "activeSpeakersChanged",
      "connectionStateChanged",
      "audioPlaybackChanged",
    ] as const;
    events.forEach((e) => room.on(e, update));
    return () => {
      events.forEach((e) => room.off(e, update));
    };
  }, [room]);
  return revision;
}
