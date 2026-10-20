import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Track, type Room, type Participant } from "livekit-client";
import { SoundPlayback } from "./sound-playback";
import { ForegroundVideo } from "./ForegroundVideo";
import {
  playbackPosition,
  settleState,
  nextPlaybackEnd,
  type StudioState,
  type Asset,
  type Playback,
} from "@studio/contracts";
export const gradients: Record<string, string> = {
  ocean: "linear-gradient(135deg,#142653 0%,#1147ea 36%,#729aff 66%,#102349 100%)",
  midnight: "repeating-linear-gradient(145deg,#111827 0px,#111827 24px,#1c2536 25px,#161e2d 50px)",
  lavender: "linear-gradient(145deg,#8177ff,#cfb9ee 50%,#f2d6eb)",
  mint: "linear-gradient(130deg,#36c1dc,#baf3df)",
  sunset: "linear-gradient(100deg,#687cf0,#f885a9)",
  berry: "linear-gradient(130deg,#3d3297,#d500c9)",
};
export type Source = {
  identity: string;
  name: string;
  camera?: Track;
  screen?: Track;
  screenSid?: string;
  microphone?: Track;
  screenAudio?: Track;
  cameraMuted?: boolean;
  isSpeaking?: boolean;
};
export function programVoices(state: StudioState, sources: Source[]): Track[] {
  if (state.clip) return [];
  return sources
    .filter((s) => state.participants.includes(s.identity))
    .flatMap((s) => (s.microphone ? [s.microphone] : []));
}
export function roomSources(room: Room): Source[] {
  return [room.localParticipant, ...room.remoteParticipants.values()]
    .filter((p) => p.identity === "host" || p.identity.startsWith("guest-"))
    .map(sourceFor);
}
function sourceFor(p: Participant): Source {
  const camera = p.getTrackPublication(Track.Source.Camera),
    screen = p.getTrackPublication(Track.Source.ScreenShare),
    microphone = p.getTrackPublication(Track.Source.Microphone);
  return {
    identity: p.identity,
    name: p.name || p.identity,
    camera: camera?.track,
    screen: screen?.isMuted ? undefined : screen?.track,
    screenSid: screen?.isMuted ? undefined : screen?.trackSid,
    microphone: microphone?.track,
    screenAudio: p.getTrackPublication(Track.Source.ScreenShareAudio)?.track,
    cameraMuted: camera?.isMuted,
    isSpeaking: p.isSpeaking && !!microphone?.track && !microphone.isMuted,
  };
}
export function VideoTrack({
  track,
  fit = "cover",
  mirror = false,
  className = "",
}: {
  track?: Track;
  fit?: "contain" | "cover";
  mirror?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || !track) return;
    track.attach(el);
    el.muted = true;
    void el.play().catch(() => {});
    return () => {
      track.detach(el);
    };
  }, [track]);
  return (
    <video
      ref={ref}
      muted
      autoPlay
      playsInline
      className={className}
      style={{
        width: "100%",
        height: "100%",
        objectFit: fit,
        transform: mirror ? "scaleX(-1)" : undefined,
      }}
    />
  );
}
export function Voice({ track }: { track: Track }) {
  const ref = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    track.attach(el);
    void el.play().catch(() => {});
    return () => {
      track.detach(el);
    };
  }, [track]);
  return <audio ref={ref} autoPlay />;
}
export async function startMediaAudio() {
  const media = document.querySelectorAll<HTMLMediaElement>(
    '.program-container [data-media-playback="playing"]',
  );
  await Promise.all([...media].filter((el) => !el.muted).map((el) => el.play()));
}
function Camera({
  source,
  style,
  transparent = false,
}: {
  source?: Source;
  style: CSSProperties;
  transparent?: boolean;
}) {
  return (
    <div
      className="program-camera"
      data-transparent={transparent || undefined}
      data-speaking={source?.isSpeaking || undefined}
      style={style}
    >
      {source?.camera && !source.cameraMuted ? (
        transparent ? (
          <ForegroundVideo track={source.camera} />
        ) : (
          <VideoTrack track={source.camera} />
        )
      ) : (
        <div className="program-avatar" data-transparent={transparent || undefined}>
          <span>{source?.name.slice(0, 1).toUpperCase() || "S"}</span>
        </div>
      )}
      {source && !transparent && <div className="program-name">{source.name}</div>}
    </div>
  );
}
function Screen({ source, style }: { source?: Source; style: CSSProperties }) {
  return (
    <div className="program-screen" style={style}>
      {source?.screen ? (
        <VideoTrack track={source.screen} fit="contain" />
      ) : (
        <span>Screen share unavailable</span>
      )}
    </div>
  );
}
export function SyncedMedia({
  playback,
  asset,
  clockOffset,
  audio,
  cancelPlayback = false,
  onError,
  onAudioBlocked,
  onReady,
}: {
  playback: Playback | null;
  asset?: Asset;
  clockOffset: number;
  audio: boolean;
  cancelPlayback?: boolean;
  onError?: (message: string) => void;
  onAudioBlocked?: () => void;
  onReady?: () => void;
}) {
  const ref = useRef<HTMLMediaElement>(null),
    current = useRef({
      playback,
      clockOffset,
      audio,
      cancelPlayback,
      onError,
      onAudioBlocked,
      onReady,
    }),
    synchronize = useRef<(() => void) | null>(null);
  current.current = {
    playback,
    clockOffset,
    audio,
    cancelPlayback,
    onError,
    onAudioBlocked,
    onReady,
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: playback and clock changes synchronize through current without rebinding the player.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let disposed = false,
      starting = false,
      blocked = false,
      needsSeek = true,
      playbackId: string | null = null;
    const sound = asset?.category === "sounds" ? new SoundPlayback() : null;
    const sync = () => {
      const { playback, clockOffset, audio, cancelPlayback, onError, onAudioBlocked } =
        current.current;
      const now = Date.now() + clockOffset,
        cue = sound?.update(playback, now, cancelPlayback),
        p = cue ? cue.playback : playback,
        oneShot = !!sound && !p?.loop;
      if (cue?.restart || p?.id !== playbackId) needsSeek = true;
      playbackId = p?.id ?? null;
      const position = p
        ? oneShot
          ? needsSeek
            ? p.position
            : el.currentTime
          : playbackPosition(p, now)
        : 0;
      el.muted = !audio;
      el.dataset.mediaPlayback = p?.playing ? "playing" : "paused";
      if (!p) {
        el.pause();
        return;
      }
      el.volume = p.volume;
      el.loop = p.loop;
      if (el.error) {
        onError?.(
          `Cannot play ${asset?.name ?? "this file"}. Check the file format and Refresh the library.`,
        );
        return;
      }
      if (el.readyState < 1) return;
      if (needsSeek || Math.abs(el.currentTime - position) > 0.35) el.currentTime = position;
      needsSeek = false;
      if (p.playing && (oneShot || p.loop || position < p.duration)) {
        if (el.paused && !starting) {
          starting = true;
          void el
            .play()
            .then(() => {
              blocked = false;
            })
            .catch((error: unknown) => {
              if (disposed || (error instanceof DOMException && error.name === "AbortError"))
                return;
              if (error instanceof DOMException && error.name === "NotAllowedError") {
                if (audio && !blocked) {
                  blocked = true;
                  if (onAudioBlocked) onAudioBlocked();
                  else
                    onError?.("Audio playback is blocked. Click Enable audio to allow playback.");
                }
              } else
                onError?.(
                  `Cannot play ${asset?.name ?? "this file"}. Check its format and connection.`,
                );
            })
            .finally(() => {
              starting = false;
            });
        }
      } else el.pause();
    };
    synchronize.current = sync;
    const ready = () => {
      sync();
      current.current.onReady?.();
    };
    const failed = () => {
      if (current.current.playback)
        current.current.onError?.(
          `Cannot play ${asset?.name ?? "this file"}. Check the file format and Refresh the library.`,
        );
    };
    const ended = () => {
      sound?.finish();
      if (sound) el.dataset.mediaPlayback = "paused";
    };
    el.addEventListener("loadedmetadata", sync);
    el.addEventListener("loadeddata", ready);
    el.addEventListener("error", failed);
    el.addEventListener("ended", ended);
    window.addEventListener("pointerdown", sync);
    window.addEventListener("keydown", sync);
    sync();
    const timer = setInterval(sync, 500);
    return () => {
      disposed = true;
      synchronize.current = null;
      clearInterval(timer);
      el.pause();
      el.removeEventListener("loadedmetadata", sync);
      el.removeEventListener("loadeddata", ready);
      el.removeEventListener("error", failed);
      el.removeEventListener("ended", ended);
      window.removeEventListener("pointerdown", sync);
      window.removeEventListener("keydown", sync);
    };
  }, [asset?.url, asset?.name]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: changes to playback, audio, and the clock need immediate synchronization.
  useEffect(() => {
    synchronize.current?.();
  }, [playback, audio, clockOffset, cancelPlayback]);
  if (!asset) return <div className="program-missing">Media unavailable</div>;
  const props = {
    src: asset.url,
    preload: "auto",
    muted: !audio,
    "data-media-playback": playback?.playing ? "playing" : "paused",
    "data-media-asset": asset.id,
  } as const;
  return asset.kind === "video" ? (
    <video
      ref={(el) => {
        ref.current = el;
      }}
      {...props}
      playsInline
      style={{ width: "100%", height: "100%", objectFit: "contain" }}
    />
  ) : (
    <audio
      ref={(el) => {
        ref.current = el;
      }}
      {...props}
    />
  );
}
export function ProgramCanvas({
  state: inputState,
  sources,
  assets,
  clockOffset = 0,
  programAudio = false,
  effectsAudio = false,
  onMediaError,
  onAudioBlocked,
}: {
  state: StudioState;
  sources: Source[];
  assets: Asset[];
  clockOffset?: number;
  programAudio?: boolean;
  effectsAudio?: boolean;
  onMediaError?: (message: string) => void;
  onAudioBlocked?: () => void;
}) {
  const container = useRef<HTMLDivElement>(null),
    [scale, setScale] = useState(1),
    [, redraw] = useState(0);
  const state = settleState(inputState, Date.now() + clockOffset);
  useEffect(() => {
    const end = nextPlaybackEnd(state);
    if (end === null) return;
    // Video paints independently of React. Only media completion needs a timed redraw.
    const timer = setTimeout(
      () => redraw((v) => v + 1),
      Math.max(1, Math.ceil(end - Date.now() - clockOffset) + 1),
    );
    return () => clearTimeout(timer);
  }, [state, clockOffset]);
  useEffect(() => {
    if (!container.current) return;
    const observer = new ResizeObserver(([entry]) => setScale(entry!.contentRect.width / 1920));
    observer.observe(container.current);
    return () => observer.disconnect();
  }, []);
  const lookup = (id: string | null) => assets.find((a) => a.id === id),
    staged = state.participants
      .map((id) => sources.find((p) => p.identity === id))
      .filter((p): p is Source => !!p);
  const featured = staged.find((p) => p.identity === state.featured) ?? staged[0],
    others = staged.filter((p) => p !== featured),
    screen = sources.find(
      (p) =>
        p.identity === state.screen?.identity &&
        (p.screenSid ?? p.screen?.sid) === state.screen?.sid,
    );
  const tiles: { source?: Source; style: CSSProperties; transparent?: boolean }[] = [],
    screens: CSSProperties[] = [];
  const rect = (left: number, top: number, width: number, height: number): CSSProperties => ({
    position: "absolute",
    left,
    top,
    width,
    height,
  });
  switch (state.layout) {
    case "solo":
      if (featured) tiles.push({ source: featured, style: rect(0, 0, 1920, 1080) });
      break;
    case "split":
      staged.slice(0, 2).forEach((s, i) =>
        tiles.push({
          source: s,
          style: rect(
            i * (1920 / Math.min(2, staged.length)),
            0,
            1920 / Math.min(2, staged.length),
            1080,
          ),
        }),
      );
      break;
    case "grid":
      staged.forEach((s, i) => {
        const n = staged.length,
          w = n === 1 ? 1560 : 852,
          h = n === 1 ? 878 : 479;
        tiles.push({
          source: s,
          style: rect(
            n === 1 ? 180 : 96 + (i % 2) * 876,
            n <= 2 ? (1080 - h) / 2 : 49 + Math.floor(i / 2) * 503,
            w,
            h,
          ),
        });
      });
      break;
    case "spotlight":
      if (featured)
        tiles.push({ source: featured, style: rect(56, 56, others.length ? 1390 : 1808, 968) });
      others.forEach((s, i) =>
        tiles.push({ source: s, style: rect(1470, 56 + i * 326, 394, 302) }),
      );
      break;
    case "screen-presenter":
      screens.push(rect(featured ? 600 : 48, 90, featured ? 1272 : 1824, 900));
      if (featured) tiles.push({ source: featured, style: rect(48, 180, 528, 720) });
      break;
    case "screen-rail": {
      const cameraHeight = 226,
        cameraGap = 24,
        railHeight = staged.length * cameraHeight + Math.max(0, staged.length - 1) * cameraGap,
        railTop = (1080 - railHeight) / 2;
      screens.push(rect(staged.length ? 402 : 48, 48, staged.length ? 1470 : 1824, 984));
      staged.forEach((s, i) =>
        tiles.push({
          source: s,
          style: rect(48, railTop + i * (cameraHeight + cameraGap), 330, cameraHeight),
        }),
      );
      break;
    }
    case "pip":
      screens.push(rect(0, 0, 1920, 1080));
      if (featured) tiles.push({ source: featured, style: rect(1548, 48, 324, 276) });
      break;
    case "pip-transparent":
      screens.push(rect(0, 0, 1920, 1080));
      if (featured)
        tiles.push({ source: featured, style: rect(1548, 756, 324, 276), transparent: true });
      break;
    case "screen-only":
      screens.push(rect(0, 0, 1920, 1080));
      break;
  }
  const bg =
    state.background.kind === "image"
      ? `url("${lookup(state.background.value)?.url ?? ""}") center / cover`
      : state.background.kind === "color"
        ? state.background.value
        : gradients[state.background.value];
  return (
    <div
      className="program-container"
      data-layout={state.layout}
      ref={container}
      style={{ aspectRatio: "16 / 9", width: "100%", position: "relative", overflow: "hidden" }}
    >
      <div
        className="program-logical"
        style={{
          width: 1920,
          height: 1080,
          transform: `scale(${scale})`,
          transformOrigin: "top left",
          position: "absolute",
          background: bg ?? "#142653",
        }}
      >
        {state.clip ? (
          <SyncedMedia
            key={state.clip.id}
            playback={state.clip}
            asset={lookup(state.clip.assetId)}
            clockOffset={clockOffset}
            audio={effectsAudio}
            onError={onMediaError}
            onAudioBlocked={onAudioBlocked}
          />
        ) : (
          <>
            {screens.map((style, i) => (
              <Screen key={i} source={screen} style={style} />
            ))}
            {tiles.map((t) => (
              <Camera key={t.source?.identity} {...t} />
            ))}
            {state.logo.visible && lookup(state.logo.assetId) && (
              <img
                className="program-logo"
                src={lookup(state.logo.assetId)!.url}
                alt=""
                style={{ [state.logo.placement]: 60 }}
              />
            )}
            <div
              className="program-overlay"
              style={{
                opacity: state.overlay.visible ? 1 : 0,
                transition: state.overlay.fade ? "opacity 200ms" : undefined,
              }}
            >
              {lookup(state.overlay.assetId) && (
                <img src={lookup(state.overlay.assetId)!.url} alt="" />
              )}
            </div>
            {!staged.length && !state.screen && (
              <div className="program-empty">
                <span>✦</span>
                <p>Your stage is ready</p>
              </div>
            )}
          </>
        )}
        {programAudio &&
          programVoices(state, sources).map((track) => (
            <Voice
              key={track.sid ?? sources.find((s) => s.microphone === track)?.identity}
              track={track}
            />
          ))}
        {programAudio && !state.clip && screen?.screenAudio && <Voice track={screen.screenAudio} />}
        {!state.clip && state.music && (
          <SyncedMedia
            key={state.music.id}
            playback={state.music}
            asset={lookup(state.music.assetId)}
            clockOffset={clockOffset}
            audio={effectsAudio}
            onError={onMediaError}
            onAudioBlocked={onAudioBlocked}
          />
        )}
        {/* Keep effects loaded between cues and reuse the element when the same sound replays. */}
        {assets
          .filter((asset) => asset.category === "sounds")
          .map((asset) => (
            <SyncedMedia
              key={`sound-${asset.id}`}
              playback={
                !state.clip && inputState.sound?.assetId === asset.id ? inputState.sound : null
              }
              asset={asset}
              clockOffset={clockOffset}
              audio={effectsAudio && !state.clip}
              cancelPlayback={
                !!state.clip || (!!inputState.sound && inputState.sound.assetId !== asset.id)
              }
              onError={onMediaError}
              onAudioBlocked={onAudioBlocked}
            />
          ))}
      </div>
    </div>
  );
}
