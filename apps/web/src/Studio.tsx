import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Room, Track, LocalVideoTrack, LocalAudioTrack } from "livekit-client";
import {
  Radio,
  Plus,
  Mic,
  MicOff,
  Camera,
  CameraOff,
  MonitorUp,
  UserPlus,
  Settings as SettingsIcon,
  LogOut,
  Headphones,
  Layers,
  Users,
  Copy,
  Check,
  Star,
  ScreenShare,
  ChevronDown,
  Info,
  Wifi,
  ArrowLeft,
  RefreshCw,
} from "lucide-react";
import { Button, Dialog, Input } from "@studio/ui";
import { ProgramCanvas, VideoTrack, Voice, roomSources, type Source } from "@studio/rendering";
import {
  layouts,
  type Asset,
  type StudioState,
  type Command,
  type BroadcastStatus,
  type JoinResponse,
  applyCommand,
  initialState,
  settleState,
  type LayoutId,
} from "@studio/contracts";
import { api, studioPath } from "./api";
import { usePreferences } from "./store";
import { Settings } from "./Settings";
import { MediaPanel } from "./MediaPanel";
import { Destinations } from "./Destinations";
import { useRoomUpdates, type Capture } from "./devices";
function GlyphPerson({ x, y, size = 1 }: { x: number; y: number; size?: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${size})`} fill="currentColor">
      <circle cy="-5" r="3.5" />
      <path d="M-7 5v-2c0-6 14-6 14 0v2z" />
    </g>
  );
}
export function LayoutGlyph({ id }: { id: LayoutId }) {
  return (
    <svg className="layout-glyph" viewBox="0 0 52 34" aria-hidden="true">
      <rect className="glyph-background" width="52" height="34" rx="2" />
      {id === "solo" && (
        <>
          <rect className="glyph-tile" x="5" y="3" width="42" height="28" />
          <GlyphPerson x={26} y={19} size={1.4} />
        </>
      )}
      {id === "split" && (
        <>
          <rect className="glyph-tile" x="2" y="2" width="23" height="30" />
          <rect className="glyph-tile" x="27" y="2" width="23" height="30" />
          <GlyphPerson x={13.5} y={19} />
          <GlyphPerson x={38.5} y={19} />
        </>
      )}
      {id === "grid" && (
        <>
          <rect className="glyph-tile" x="3" y="9" width="22" height="17" rx="2" />
          <rect className="glyph-tile" x="27" y="9" width="22" height="17" rx="2" />
          <GlyphPerson x={14} y={19} size={0.8} />
          <GlyphPerson x={38} y={19} size={0.8} />
        </>
      )}
      {id === "spotlight" && (
        <>
          <GlyphPerson x={19} y={19} size={1.1} />
          {[9, 18, 27].map((y) => (
            <GlyphPerson key={y} x={42} y={y} size={0.45} />
          ))}
        </>
      )}
      {id === "screen-presenter" && (
        <>
          <GlyphPerson x={12} y={19} size={1.05} />
          <rect className="glyph-screen" x="25" y="8" width="23" height="18" rx="1" />
        </>
      )}
      {id === "screen-rail" && (
        <>
          {[9, 18, 27].map((y) => (
            <GlyphPerson key={y} x={8} y={y} size={0.45} />
          ))}
          <rect className="glyph-screen" x="16" y="4" width="32" height="26" rx="1" />
        </>
      )}
      {id === "pip" && (
        <>
          <rect className="glyph-screen" x="5" y="5" width="42" height="24" rx="1" />
          <g className="glyph-inset">
            <GlyphPerson x={12} y={25} size={0.5} />
          </g>
        </>
      )}
      {id === "screen-only" && (
        <rect className="glyph-screen" x="5" y="5" width="42" height="24" rx="1" />
      )}
    </svg>
  );
}
export function Studio({
  room,
  joinData,
  capture,
  preview,
  onLeave,
  onReconnect,
}: {
  room: Room | null;
  joinData: JoinResponse | null;
  capture: Capture;
  preview: boolean;
  onLeave: () => void;
  onReconnect: (data: JoinResponse) => Promise<void>;
}) {
  const { studioId = "personal" } = useParams(),
    navigate = useNavigate(),
    revision = useRoomUpdates(room);
  const [state, setState] = useState<StudioState>(
      joinData?.state ?? {
        ...initialState(),
        participants: ["host", "guest-preview-1", "guest-preview-2", "guest-preview-3"],
        featured: "host",
        layout: "grid",
        screen: { identity: "host", sid: "preview-screen" },
      },
    ),
    [offset, setOffset] = useState(joinData ? joinData.serverTime - Date.now() : 0),
    [assets, setAssets] = useState<Asset[]>([]),
    [status, setStatus] = useState<BroadcastStatus | null>(null),
    [error, setError] = useState(""),
    [settings, setSettings] = useState(false),
    [destinations, setDestinations] = useState(false),
    [invite, setInvite] = useState(""),
    [inviting, setInviting] = useState(false),
    [copied, setCopied] = useState(false),
    [monitor, setMonitor] = useState(false),
    [mediaBusy, setMediaBusy] = useState(false),
    [actionBusy, setActionBusy] = useState(false),
    [panel, setPanel] = useState("media"),
    [sidebarOpen, setSidebarOpen] = useState(true),
    [endDialog, setEndDialog] = useState(false);
  const [deviceBusy, setDeviceBusy] = useState(false);
  const preferences = usePreferences();
  const host = preview || joinData?.role === "host";
  const sources: Source[] = room
    ? roomSources(room)
    : [
        {
          identity: "host",
          name: joinData?.name || "You",
          camera: capture.camera,
          cameraMuted: capture.camera?.isMuted,
        },
        ...["Alex", "Morgan", "Jamie"].map((name, i) => ({
          identity: `guest-preview-${i + 1}`,
          name: `${name} · sample`,
        })),
      ];
  const connected = preview || room?.state === "connected";
  const handleError = useCallback((message: string) => setError(message), []);
  const refresh = useCallback(async () => {
    if (preview) return;
    setMediaBusy(true);
    try {
      const data = await api<{ assets: Asset[] }>(studioPath(studioId, "assets"));
      setAssets(data.assets);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setMediaBusy(false);
    }
  }, [studioId, preview]);
  const refreshStatus = useCallback(async () => {
    if (!preview && host)
      try {
        setStatus(await api<BroadcastStatus>(studioPath(studioId, "broadcast")));
      } catch (e) {
        setError((e as Error).message);
      }
  }, [studioId, preview, host]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  useEffect(() => {
    if (preview) {
      const timer = setInterval(() => setState((s) => settleState(s, Date.now())), 250);
      return () => clearInterval(timer);
    }
    let alive = true;
    const sync = async () => {
      try {
        const start = Date.now();
        const data = await api<{ state: StudioState; serverTime: number }>(
          studioPath(studioId, "state"),
        );
        if (alive) {
          setState((s) => (data.state.revision >= s.revision ? data.state : s));
          setOffset(data.serverTime - (start + Date.now()) / 2);
        }
      } catch (e) {
        if (alive) setError((e as Error).message);
      }
    };
    const metadata = (value: string) => {
      try {
        const snapshot = JSON.parse(value) as StudioState;
        if (snapshot.version === 1)
          setState((s) => (snapshot.revision >= s.revision ? snapshot : s));
      } catch {
        setError("The studio state could not be read. Reconnect to reload it.");
      }
    };
    room?.on("roomMetadataChanged", metadata);
    void sync();
    void refreshStatus();
    const timer = setInterval(() => {
      void sync();
      void refreshStatus();
    }, 2500);
    return () => {
      alive = false;
      clearInterval(timer);
      room?.off("roomMetadataChanged", metadata);
    };
  }, [room, studioId, preview, refreshStatus]);
  const command = async (c: Command) => {
    setError("");
    try {
      if (preview) {
        const next = applyCommand(state, c, Date.now());
        setState(next);
        if (["layout", "background", "logo", "overlay"].includes(c.type))
          preferences.set({
            visual: {
              layout: next.layout,
              background: next.background,
              logo: next.logo,
              overlay: next.overlay,
            },
          });
      } else {
        const data = await api<{ state: StudioState; serverTime: number }>(
          studioPath(studioId, "commands"),
          c,
        );
        setState((s) => (data.state.revision >= s.revision ? data.state : s));
        if (["layout", "background", "logo", "overlay"].includes(c.type))
          preferences.set({
            visual: {
              layout: data.state.layout,
              background: data.state.background,
              logo: data.state.logo,
              overlay: data.state.overlay,
            },
          });
      }
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const mic = room?.localParticipant.getTrackPublication(Track.Source.Microphone),
    cam = room?.localParticipant.getTrackPublication(Track.Source.Camera);
  const sharing = room ? room.localParticipant.isScreenShareEnabled : !!state.screen;
  const toggle = async (type: "mic" | "camera" | "screen") => {
    if (deviceBusy) return;
    setDeviceBusy(true);
    try {
      setError("");
      if (!room) {
        if (type === "screen") {
          await command({
            type: "screen",
            screen: state.screen ? null : { identity: "host", sid: "preview-screen" },
          });
          return;
        }
        const track = type === "mic" ? capture.microphone : capture.camera;
        if (track) {
          if (track.isMuted) await track.unmute();
          else await track.mute();
        } else await capture.enable(type === "mic" ? "microphone" : "camera");
        return;
      }
      if (type === "mic") await room.localParticipant.setMicrophoneEnabled(!mic || mic.isMuted);
      if (type === "camera") await room.localParticipant.setCameraEnabled(!cam || cam.isMuted);
      if (type === "screen") {
        const publication = await room.localParticipant.setScreenShareEnabled(!sharing, {
          audio: true,
          resolution: { width: 1920, height: 1080, frameRate: 60 },
        });
        if (host && (!sharing || state.screen?.identity === room.localParticipant.identity))
          await command({
            type: "screen",
            screen: sharing
              ? null
              : publication
                ? { identity: room.localParticipant.identity, sid: publication.trackSid }
                : null,
          });
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setDeviceBusy(false);
    }
  };
  useEffect(() => {
    const keyboard = (e: KeyboardEvent) => {
      if (
        e.metaKey ||
        e.ctrlKey ||
        e.altKey ||
        (e.target instanceof HTMLElement &&
          e.target.closest('input,textarea,select,[contenteditable], [role="dialog"]'))
      )
        return;
      if (e.key.toLowerCase() === "m") void toggle("mic");
      if (e.key.toLowerCase() === "c") void toggle("camera");
    };
    window.addEventListener("keydown", keyboard);
    return () => window.removeEventListener("keydown", keyboard);
  });
  const start = async () => {
    setActionBusy(true);
    setError("");
    try {
      if (preview)
        throw new Error(
          "Preview mode cannot broadcast. Configure .env and enter the studio with your host passcode.",
        );
      const result = await api<BroadcastStatus>(studioPath(studioId, "broadcast/start"), {});
      setStatus(result);
      if (!result.live)
        throw new Error("The streaming outputs could not start. Check destination status.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setActionBusy(false);
    }
  };
  const stop = async () => {
    setActionBusy(true);
    setError("");
    try {
      setStatus(await api<BroadcastStatus>(studioPath(studioId, "broadcast/stop"), {}));
      setEndDialog(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setActionBusy(false);
    }
  };
  const makeInvite = async () => {
    setInviting(true);
    setError("");
    try {
      if (preview) throw new Error("Guest invites are available after you connect to LiveKit.");
      setInvite((await api<{ url: string }>(studioPath(studioId, "invite"), {})).url);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setInviting(false);
    }
  };
  const actual = (
    cam?.track instanceof LocalVideoTrack ? cam.track : capture.camera
  )?.mediaStreamTrack.getSettings();
  const activeCapture = {
    ...capture,
    camera: room ? (cam?.track instanceof LocalVideoTrack ? cam.track : undefined) : capture.camera,
    microphone: room
      ? mic?.track instanceof LocalAudioTrack
        ? mic.track
        : undefined
      : capture.microphone,
  };
  const failed = status?.groups.some(
    (g) => g.status === "failed" || g.destinations.some((d) => d.status === "failed"),
  );
  return (
    <div
      className={`studio-page ${sidebarOpen ? "" : "sidebar-collapsed"}`}
      data-revision={revision}
    >
      <header className="studio-header">
        <a
          className="brand"
          href="/"
          onClick={(e) => {
            e.preventDefault();
            onLeave();
            navigate(`/join/${studioId}`);
          }}
        >
          <span className="brand-icon">
            <Radio size={22} />
          </span>
          studio<span className="brand-dot">.</span>
        </a>
        <div className="studio-title">
          <input
            key={state.title}
            aria-label="Broadcast title"
            defaultValue={state.title}
            readOnly={!host}
            maxLength={100}
            onBlur={(e) => {
              if (e.target.value.trim() && e.target.value !== state.title)
                void command({ type: "title", title: e.target.value });
            }}
          />
          <span>
            {preview ? "PREVIEW" : joinData?.role === "guest" ? "GUEST" : "PERSONAL STUDIO"}
          </span>
        </div>
        <div className="header-actions">
          {status?.live ? (
            <span className="live-pill">
              <span />
              LIVE
            </span>
          ) : (
            <span className="ready-pill">
              <span />
              {preview ? "Preview" : "Studio ready"}
            </span>
          )}
          {host && (
            <>
              <Button variant="secondary" size="sm" onClick={() => setDestinations(true)}>
                <Plus size={16} />
                Destinations
              </Button>
              <Button
                variant={status?.live ? "danger" : "default"}
                size="sm"
                disabled={actionBusy || !connected}
                onClick={() => (status?.live ? setEndDialog(true) : void start())}
              >
                <Radio size={15} />
                {actionBusy ? "Please wait…" : status?.live ? "End stream" : "Go live"}
              </Button>
            </>
          )}
        </div>
      </header>
      {preview && (
        <div className="preview-banner">
          <Info size={15} />
          <span>Interface preview · sample guests · streaming is unavailable here.</span>
          <button
            onClick={() => {
              onLeave();
              navigate(`/join/${studioId}`);
            }}
          >
            Connect your studio
            <ArrowLeft size={13} />
          </button>
        </div>
      )}
      {!connected && !preview && (
        <div className="connection-banner">
          <Wifi size={17} />
          <span>Disconnected. Your broadcast status is retained on the server.</span>
          <Button
            size="sm"
            onClick={() => {
              void api<JoinResponse>(studioPath(studioId, "join"), {})
                .then(onReconnect)
                .catch((e) => setError(e.message));
            }}
          >
            Reconnect
          </Button>
        </div>
      )}
      {error && (
        <div className="error-banner" role="alert">
          <Info size={17} />
          <span>{error}</span>
          <button aria-label="Dismiss error" onClick={() => setError("")}>
            ×
          </button>
        </div>
      )}
      <div className="studio-workspace">
        <main className="stage-area">
          <div className="stage-heading">
            <span>
              <span className={`tiny-dot ${status?.live ? "red" : ""}`} />
              {status?.live ? "Live program" : "Program preview"}
            </span>
            <span>
              1920 × 1080 <span className="divider-dot">·</span> 60 fps
            </span>
          </div>
          <div className="stage-frame">
            <ProgramCanvas
              state={state}
              sources={sources}
              assets={assets}
              clockOffset={offset}
              effectsAudio={host && monitor}
              onMediaError={handleError}
            />
            <span className="program-quality">1080p60</span>
            {state.clip && <span className="clip-badge">CLIP PLAYING · LIVE MICS EXCLUDED</span>}
          </div>
          <div className="stage-options">
            <div className="layout-strip" aria-label="Program layouts">
              {layouts.map((layout) => (
                <button
                  aria-label={layout.name}
                  aria-pressed={state.layout === layout.id}
                  title={layout.name}
                  key={layout.id}
                  disabled={!host || (layout.screen && !state.screen)}
                  className={state.layout === layout.id ? "active" : ""}
                  onClick={() => void command({ type: "layout", layout: layout.id })}
                >
                  <LayoutGlyph id={layout.id} />
                </button>
              ))}
            </div>
            <span className="layout-label">{layouts.find((l) => l.id === state.layout)?.name}</span>
          </div>
          <div className="backstage-heading">
            <h2>
              People <span>{sources.length} / 4</span>
            </h2>
            <p>
              {host ? "Choose who appears on stage." : "The host controls who appears on stage."}
            </p>
          </div>
          <div className="backstage-cards">
            {sources.map((source) => {
              const staged = state.participants.includes(source.identity),
                selected = state.featured === source.identity;
              return (
                <article
                  className={`person-card ${staged ? "on-stage" : ""}`}
                  key={source.identity}
                >
                  <div className="person-preview">
                    {source.camera && !source.cameraMuted ? (
                      <VideoTrack
                        track={source.camera}
                        mirror={
                          preferences.mirror && source.identity === (joinData?.identity ?? "host")
                        }
                      />
                    ) : (
                      <span className="person-avatar">{source.name.charAt(0)}</span>
                    )}
                    <span className="person-status">{staged ? "ON STAGE" : "BACKSTAGE"}</span>
                    {selected && (
                      <span className="person-featured">
                        <Star size={11} fill="currentColor" />
                      </span>
                    )}
                    {host && (
                      <button
                        className="person-stage-button"
                        aria-label={`${staged ? "Remove" : "Add"} ${source.name} ${staged ? "from" : "to"} stage`}
                        onClick={() =>
                          void command({
                            type: staged ? "stage.remove" : "stage.add",
                            identity: source.identity,
                          })
                        }
                      >
                        {staged ? "Remove" : "Add to stage"}
                      </button>
                    )}
                  </div>
                  <div className="person-details">
                    <span>
                      {source.name}
                      {source.identity === "host" && <small>Host</small>}
                    </span>
                    {host && (
                      <div>
                        {staged && (
                          <button
                            title="Feature camera"
                            aria-label={`Feature ${source.name}`}
                            onClick={() =>
                              void command({ type: "feature", identity: source.identity })
                            }
                          >
                            <Star size={13} fill={selected ? "currentColor" : "none"} />
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </article>
              );
            })}
            {host && sources.length < 4 && (
              <button className="invite-card" disabled={inviting} onClick={() => void makeInvite()}>
                <UserPlus size={25} />
                <strong>Invite a guest</strong>
                <span>Room for a conversation</span>
              </button>
            )}
          </div>
          {sources.some((source) => source.screenSid) && (
            <div className="screen-share-cards" aria-label="Available screen shares">
              {sources
                .filter((source) => source.screenSid)
                .map((source) => {
                  const selected = state.screen?.sid === source.screenSid;
                  const local = source.identity === room?.localParticipant.identity;
                  return (
                    <article
                      className={`screen-share-card ${selected ? "on-stage" : ""}`}
                      key={source.screenSid}
                    >
                      <div className="screen-share-preview">
                        {source.screen ? (
                          <VideoTrack track={source.screen} fit="contain" />
                        ) : (
                          <span>Connecting screen…</span>
                        )}
                        <span className="person-status">{selected ? "ON STAGE" : "BACKSTAGE"}</span>
                      </div>
                      <div className="screen-share-details">
                        <span>
                          <ScreenShare size={14} />
                          {source.name}’s screen
                        </span>
                        <div>
                          {host && (
                            <Button
                              size="sm"
                              variant="secondary"
                              aria-label={`${selected ? "Remove" : "Stage"} ${source.name}'s screen`}
                              onClick={() =>
                                void command({
                                  type: "screen",
                                  screen: selected
                                    ? null
                                    : { identity: source.identity, sid: source.screenSid! },
                                })
                              }
                            >
                              {selected ? "Remove from stage" : "Stage screen"}
                            </Button>
                          )}
                          {local && (
                            <Button
                              size="sm"
                              variant="secondary"
                              disabled={deviceBusy}
                              onClick={() => void toggle("screen")}
                            >
                              Stop sharing
                            </Button>
                          )}
                        </div>
                      </div>
                    </article>
                  );
                })}
            </div>
          )}
          {failed && (
            <button className="failed-output" onClick={() => setDestinations(true)}>
              An output needs attention. Open destinations to inspect its status.
            </button>
          )}
          <footer className="studio-footer">
            <span className="connection-label">
              <span className="tiny-dot" />
              {preview
                ? "Preview mode"
                : room?.state === "connected"
                  ? "Connected to studio"
                  : "Reconnecting…"}
            </span>
            <div className="bottom-controls">
              <Button
                variant={
                  mic?.isMuted || (!room && capture.microphone?.isMuted) ? "danger" : "secondary"
                }
                size="icon"
                title="Microphone (M)"
                aria-label={mic?.isMuted ? "Unmute microphone" : "Toggle microphone"}
                disabled={deviceBusy}
                onClick={() => void toggle("mic")}
              >
                {mic?.isMuted || (!room && capture.microphone?.isMuted) ? (
                  <MicOff size={19} />
                ) : (
                  <Mic size={19} />
                )}
              </Button>
              <Button
                variant={
                  cam?.isMuted || (!room && capture.camera?.isMuted) ? "danger" : "secondary"
                }
                size="icon"
                title="Camera (C)"
                aria-label="Toggle camera"
                disabled={deviceBusy}
                onClick={() => void toggle("camera")}
              >
                {cam?.isMuted ? <CameraOff size={19} /> : <Camera size={19} />}
              </Button>
              <Button
                variant={sharing ? "default" : "secondary"}
                size="icon"
                aria-label={sharing ? "Stop screen share" : "Share screen"}
                aria-pressed={sharing}
                title={sharing ? "Stop screen share" : "Share screen"}
                disabled={deviceBusy || !connected}
                onClick={() => void toggle("screen")}
              >
                <MonitorUp size={19} />
              </Button>
              {host && (
                <Button
                  variant="secondary"
                  size="icon"
                  aria-label="Invite guests"
                  onClick={() => void makeInvite()}
                >
                  <UserPlus size={19} />
                </Button>
              )}
              <span className="control-separator" />
              <Button
                variant="secondary"
                size="icon"
                aria-label="Open settings"
                onClick={() => setSettings(true)}
              >
                <SettingsIcon size={19} />
              </Button>
              {room && !room.canPlaybackAudio && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() =>
                    void room
                      .startAudio()
                      .catch(() =>
                        setError("Audio could not start. Check your browser audio permissions."),
                      )
                  }
                >
                  Enable audio
                </Button>
              )}
              {host && (
                <Button
                  variant={monitor ? "default" : "secondary"}
                  size="icon"
                  aria-pressed={monitor}
                  aria-label="Headphone effects monitor"
                  title="Monitor effects in headphones"
                  onClick={() => setMonitor(!monitor)}
                >
                  <Headphones size={19} />
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon"
                aria-label="Leave studio"
                onClick={() => {
                  onLeave();
                  navigate(`/join/${studioId}`);
                }}
              >
                <LogOut size={19} />
              </Button>
            </div>
            <span className="source-capture">
              {actual
                ? `${actual.height}p · ${Math.round(actual.frameRate ?? 0)} fps camera`
                : "Camera off"}
            </span>
          </footer>
        </main>
        {sidebarOpen &&
          (host && panel === "media" ? (
            <MediaPanel
              state={state}
              assets={assets}
              refresh={refresh}
              command={command}
              busy={mediaBusy}
              preview={preview}
            />
          ) : (
            <aside className="media-panel people-panel">
              <div className="panel-header">
                <strong>{host ? "People" : "Guest studio"}</strong>
              </div>
              <Users size={35} />
              <h3>
                {host ? "Make room for great conversations." : "Welcome to the conversation."}
              </h3>
              <p>
                {host
                  ? "Invite up to three guests. They join backstage until you add them to the program."
                  : "Your camera and microphone are connected. The host will add you to the stage when it’s your turn."}
              </p>
              {host && (
                <Button disabled={inviting} onClick={() => void makeInvite()}>
                  <UserPlus size={16} />
                  Invite guest
                </Button>
              )}
              <p className="hint">
                Program preview is muted.{" "}
                {host
                  ? "Your headphone monitor plays effects only."
                  : "Guests hear room voices; program clips and music reach viewers."}
              </p>
            </aside>
          ))}
        <nav className="panel-rail">
          {host && (
            <button
              className={panel === "media" ? "active" : ""}
              onClick={() => {
                setPanel("media");
                setSidebarOpen(true);
                void refresh();
              }}
            >
              <Layers size={21} />
              <span>Media</span>
            </button>
          )}
          <button
            className={panel === "people" ? "active" : ""}
            onClick={() => {
              setPanel("people");
              setSidebarOpen(true);
            }}
          >
            <Users size={21} />
            <span>People</span>
          </button>
          <button
            aria-label={sidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
            className="rail-collapse"
            onClick={() => setSidebarOpen(!sidebarOpen)}
          >
            <ChevronDown
              size={18}
              style={{ transform: sidebarOpen ? "rotate(90deg)" : "rotate(-90deg)" }}
            />
          </button>
        </nav>
      </div>
      {room &&
        sources
          .filter((s) => s.identity !== room.localParticipant.identity)
          .map((s) => (s.microphone ? <Voice key={s.identity} track={s.microphone} /> : null))}
      <Settings
        open={settings}
        onClose={() => setSettings(false)}
        capture={activeCapture}
        assets={assets}
      />
      <Destinations
        open={destinations}
        onClose={() => setDestinations(false)}
        studioId={studioId}
        preview={preview}
        status={status}
        onSaved={() => void refreshStatus()}
      />
      <Dialog
        open={!!invite}
        onOpenChange={(v) => {
          if (!v) {
            setInvite("");
            setCopied(false);
          }
        }}
        title="Invite guests"
        description="Share this private link with up to three guests."
      >
        <p className="hint">
          The link expires after 12 hours. Guests join backstage, and you choose when to add them to
          the program.
        </p>
        <div className="invite-link">
          <Input readOnly value={invite} aria-label="Guest invitation link" />
          <Button
            onClick={() => {
              void navigator.clipboard
                .writeText(invite)
                .then(() => setCopied(true))
                .catch(() => setError("Select and copy the invitation link manually."));
            }}
          >
            {copied ? <Check size={17} /> : <Copy size={17} />} {copied ? "Copied" : "Copy"}
          </Button>
        </div>
      </Dialog>
      <Dialog
        open={endDialog}
        onOpenChange={setEndDialog}
        title="End your broadcast?"
        description="All active streaming outputs will stop. You and your guests stay in the studio."
      >
        <div className="dialog-actions">
          <Button variant="secondary" onClick={() => setEndDialog(false)}>
            Keep broadcasting
          </Button>
          <Button variant="danger" disabled={actionBusy} onClick={() => void stop()}>
            {actionBusy ? "Stopping…" : "End all outputs"}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
