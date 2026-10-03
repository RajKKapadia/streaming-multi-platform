import { useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  Camera,
  CameraOff,
  Mic,
  MicOff,
  Settings as SettingsIcon,
  ArrowRight,
  Headphones,
  Radio,
  Info,
} from "lucide-react";
import { Button, Input } from "@studio/ui";
import { VideoTrack } from "@studio/rendering";
import type { Asset, JoinResponse } from "@studio/contracts";
import { TrackEvent } from "livekit-client";
import { api, studioPath } from "./api";
import { usePreferences } from "./store";
import { useMicrophoneLevel, type Capture } from "./devices";
import { Settings } from "./Settings";
export function Prejoin({
  capture,
  onJoin,
  onPreview,
}: {
  capture: Capture;
  onJoin: (data: JoinResponse) => Promise<void>;
  onPreview: (id: string) => void;
}) {
  const { studioId = "personal" } = useParams(),
    [params] = useSearchParams(),
    navigate = useNavigate(),
    invite = params.get("invite");
  const preferences = usePreferences(),
    [passcode, setPasscode] = useState(""),
    [busy, setBusy] = useState(false),
    [settings, setSettings] = useState(false),
    [assets, setAssets] = useState<Asset[]>([]),
    [error, setError] = useState(""),
    [issues, setIssues] = useState<string[]>([]),
    [session, setSession] = useState<{ studio: string; role: string } | null>(null),
    [micMuted, setMicMuted] = useState(false),
    [camMuted, setCamMuted] = useState(false);
  const level = useMicrophoneLevel(capture.microphone);
  useEffect(() => {
    void api<{ issues: string[] }>("/health")
      .then((h) => setIssues(h.issues))
      .catch((e) => setError(e.message));
    void api<{ studio: string; role: string } | null>("/session").then(setSession);
  }, []);
  useEffect(() => {
    setAssets([]);
    if (!settings || (!invite && session?.studio !== studioId)) return;
    let alive = true;
    void api<{ assets: Asset[] }>(studioPath(studioId, "backgrounds", invite ?? undefined))
      .then((data) => {
        if (alive) setAssets(data.assets);
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [settings, studioId, invite, session?.studio]);
  useEffect(() => {
    const sync = () => {
      setCamMuted(!!capture.camera?.isMuted);
      setMicMuted(!!capture.microphone?.isMuted);
    };
    sync();
    const tracks = [capture.camera, capture.microphone];
    for (const track of tracks) {
      track?.on(TrackEvent.Muted, sync);
      track?.on(TrackEvent.Unmuted, sync);
    }
    return () => {
      for (const track of tracks) {
        track?.off(TrackEvent.Muted, sync);
        track?.off(TrackEvent.Unmuted, sync);
      }
    };
  }, [capture.camera, capture.microphone]);
  const join = async () => {
    setBusy(true);
    setError("");
    try {
      if (!preferences.name.trim()) throw new Error("Enter your display name.");
      if (invite) await api("/guest-session", { invite, name: preferences.name });
      else if (session?.studio !== studioId || session.role !== "host" || passcode)
        await api("/session", { studio: studioId, name: preferences.name, passcode });
      const data = await api<JoinResponse>(studioPath(studioId, "join"), {
        name: preferences.name,
        visual: preferences.visual,
      });
      await onJoin(data);
      setPasscode("");
      navigate(`/studio/${studioId}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const toggle = async (channel: "camera" | "microphone") => {
    const track = capture[channel];
    if (!track) {
      await capture.enable(channel);
      return;
    }
    try {
      if (track.isMuted) await track.unmute();
      else await track.mute();
      if (channel === "camera") setCamMuted(track.isMuted);
      else setMicMuted(track.isMuted);
    } catch (e) {
      capture.setError((e as Error).message);
    }
  };
  return (
    <div className="prejoin-page">
      <header className="landing-header">
        <a href="/" className="brand">
          <span className="brand-icon">
            <Radio size={23} />
          </span>
          studio<span className="brand-dot">.</span>
        </a>
        <span className="header-note">Your broadcast, your way.</span>
      </header>
      <main className="prejoin-main">
        <div className="tip">
          <Headphones size={17} />
          <span>For clear audio, wear headphones while you’re in the studio.</span>
        </div>
        <div className="prejoin-grid">
          <div>
            <div className="camera-preview">
              {capture.camera && !camMuted ? (
                <VideoTrack track={capture.camera} mirror={preferences.mirror} />
              ) : (
                <div className="camera-placeholder">
                  <div className="camera-symbol">
                    <Camera size={40} />
                  </div>
                  <h3>Your camera preview</h3>
                  <p>Take a moment to get ready.</p>
                  <Button
                    variant="secondary"
                    disabled={capture.busy}
                    onClick={() => void capture.enable()}
                  >
                    {capture.busy ? "Connecting…" : "Enable camera & microphone"}
                  </Button>
                </div>
              )}
              <span className="capture-badge">
                {capture.camera
                  ? `${capture.camera.mediaStreamTrack.getSettings().height ?? 1080}p`
                  : "1080p60 requested"}
              </span>
              <span className="preview-name">{preferences.name || "Your name"}</span>
              <div className="preview-tools">
                <Button
                  size="icon"
                  variant="ghost"
                  disabled={capture.busy}
                  aria-label={
                    !capture.microphone
                      ? "Enable microphone"
                      : micMuted
                        ? "Unmute microphone"
                        : "Mute microphone"
                  }
                  onClick={() => void toggle("microphone")}
                >
                  {micMuted ? <MicOff size={19} /> : <Mic size={19} />}
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  disabled={capture.busy}
                  aria-label={
                    !capture.camera
                      ? "Enable camera"
                      : camMuted
                        ? "Turn camera on"
                        : "Turn camera off"
                  }
                  onClick={() => void toggle("camera")}
                >
                  {camMuted ? <CameraOff size={19} /> : <Camera size={19} />}
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label="Open settings"
                  onClick={() => setSettings(true)}
                >
                  <SettingsIcon size={19} />
                </Button>
              </div>
            </div>
            <p className="preview-caption">
              <span className="tiny-dot" />
              Your preview stays private until you enter.
            </p>
          </div>
          <section className="join-form">
            <span className="eyebrow">{invite ? "YOU’RE INVITED" : "LET’S GET STARTED"}</span>
            <h1>Set up your studio.</h1>
            <p className="subtle">
              Check your devices and make yourself at home.
              <br />
              Entering won’t start your broadcast.
            </p>
            <button
              className="mic-test"
              disabled={capture.busy}
              aria-label={
                capture.microphone
                  ? micMuted
                    ? "Unmute microphone for mic check"
                    : "Mute microphone for mic check"
                  : "Start mic check"
              }
              onClick={() => void toggle("microphone")}
            >
              <Mic size={17} />
              <div className="meter">
                {Array.from({ length: 24 }, (_, i) => (
                  <i key={i} className={i / 24 < level && !micMuted ? "lit" : ""} />
                ))}
              </div>
              <span>
                {capture.microphone ? (micMuted ? "Muted" : "Mic check") : "Start mic check"}
              </span>
            </button>
            <label>
              Display name
              <Input
                value={preferences.name}
                onChange={(e) => preferences.set({ name: e.target.value })}
                placeholder="How should we call you?"
                maxLength={80}
              />
            </label>
            {!invite && session?.studio !== studioId && (
              <label>
                Host passcode
                <Input
                  type="password"
                  autoComplete="current-password"
                  value={passcode}
                  onChange={(e) => setPasscode(e.target.value)}
                  placeholder="Your private studio passcode"
                />
              </label>
            )}
            <Button className="enter-button" onClick={() => void join()} disabled={busy}>
              {busy ? "Entering studio…" : invite ? "Join as guest" : "Enter studio"}
              <ArrowRight size={18} />
            </Button>
            {(error || capture.error) && (
              <p role="alert" className="error">
                {error || capture.error}
              </p>
            )}
            {issues.length > 0 && !invite && (
              <div className="setup-notice">
                <Info size={17} />
                <div>
                  <strong>Server setup needed</strong>
                  <p>{issues.join(" ")}</p>
                </div>
              </div>
            )}
            <button
              className="text-link preview-link"
              onClick={() => {
                onPreview(studioId);
                navigate(`/studio/${studioId}?preview=1`);
              }}
            >
              Explore studio preview
            </button>
          </section>
        </div>
        <p className="prejoin-footer">
          Made for conversations worth sharing. <span>1080p · 60 fps program</span>
        </p>
      </main>
      <Settings
        open={settings}
        onClose={() => setSettings(false)}
        capture={capture}
        assets={assets}
        autoEnableCamera
      />
    </div>
  );
}
