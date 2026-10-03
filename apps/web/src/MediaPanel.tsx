import { useEffect, useState } from "react";
import {
  RefreshCw,
  Plus,
  Check,
  Image,
  Play,
  Pause,
  Square,
  FolderOpen,
  Volume2,
  Music,
  Layers,
  ChevronDown,
} from "lucide-react";
import { Button, Switch, Slider } from "@studio/ui";
import { gradients } from "@studio/rendering";
import type { Asset, StudioState, Command, Playback, AssetCategory } from "@studio/contracts";
type Probe = { duration: number; error?: string };
export function probeAsset(asset: Asset): Promise<Probe> {
  return new Promise((resolve) => {
    const el = document.createElement(asset.kind === "video" ? "video" : "audio");
    let finished = false;
    const finish = (result: Probe) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      el.removeAttribute("src");
      el.load();
      resolve(result);
    };
    const timer = setTimeout(
      () =>
        finish({
          duration: 0,
          error: "This file could not load. Check its format and connection.",
        }),
      12000,
    );
    el.preload = "auto";
    el.oncanplay = () =>
      finish(
        Number.isFinite(el.duration) && el.duration > 0
          ? { duration: el.duration }
          : { duration: 0, error: "This file has no readable duration." },
      );
    el.onerror = () => finish({ duration: 0, error: "Unsupported codec or damaged file." });
    el.src = asset.url;
    el.load();
  });
}
const durationText = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, "0")}`;
export function MediaPanel({
  state,
  assets,
  refresh,
  command,
  busy,
  preview,
}: {
  state: StudioState;
  assets: Asset[];
  refresh: () => Promise<void>;
  command: (c: Command) => Promise<void>;
  busy: boolean;
  preview: boolean;
}) {
  const [probes, setProbes] = useState<Record<string, Probe>>({}),
    [loop, setLoop] = useState({ clip: false, music: true, sound: false });
  useEffect(() => {
    let alive = true;
    const queue = assets.filter((a) => a.kind !== "image");
    void (async () => {
      for (const asset of queue) {
        const result = await probeAsset(asset);
        if (!alive) return;
        setProbes((p) => ({ ...p, [`${asset.id}:${asset.version}`]: result }));
      }
    })();
    return () => {
      alive = false;
    };
  }, [assets]);
  const byCategory = (category: AssetCategory) => assets.filter((a) => a.category === category);
  const empty = (category: AssetCategory) => (
    <div className="empty-assets">
      <FolderOpen size={19} />
      <span>
        Add files to <code>media/{category}/</code>
      </span>
    </div>
  );
  const execute = (c: Command) => void command(c);
  const play = (channel: "clip" | "music" | "sound", asset: Asset) => {
    const p = probes[`${asset.id}:${asset.version}`];
    if (p && !p.error)
      execute({
        type: "play",
        channel,
        assetId: asset.id,
        duration: p.duration,
        loop: loop[channel],
        volume: channel === "music" ? 0.35 : 1,
      });
  };
  const playback = (channel: "clip" | "music" | "sound", p: Playback | null) =>
    p && (
      <div className="playback-controls">
        <span className="now-playing">
          {assets.find((a) => a.id === p.assetId)?.name ?? "Missing file"}
        </span>
        <div className="playback-buttons">
          <Button
            variant="ghost"
            size="icon"
            aria-label={p.playing ? `Pause ${channel}` : `Resume ${channel}`}
            disabled={!!state.clip && channel !== "clip"}
            onClick={() =>
              execute({ type: "playback", channel, action: p.playing ? "pause" : "resume" })
            }
          >
            {p.playing ? <Pause size={15} /> : <Play size={15} />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Stop ${channel}`}
            onClick={() => execute({ type: "playback", channel, action: "stop" })}
          >
            <Square size={14} />
          </Button>
          <Volume2 size={15} />
          <Slider
            label={`${channel} volume`}
            value={p.volume}
            onValueChange={(volume) => execute({ type: "volume", channel, volume })}
          />
        </div>
      </div>
    );
  const mediaCards = (
    category: "clips" | "music" | "sounds",
    channel: "clip" | "music" | "sound",
  ) => (
    <>
      <div className="setting-line compact">
        <Switch
          checked={state[channel]?.loop ?? loop[channel]}
          onCheckedChange={(v) => {
            setLoop((p) => ({ ...p, [channel]: v }));
            if (state[channel]) execute({ type: "loop", channel, loop: v });
          }}
          label={`Loop ${category}`}
        />
        <span>Loop</span>
      </div>
      <div className="asset-grid">
        {byCategory(category).map((asset) => {
          const probe = probes[`${asset.id}:${asset.version}`],
            active = state[channel]?.assetId === asset.id;
          return (
            <button
              className={`asset-card ${active ? "selected" : ""}`}
              key={asset.id}
              disabled={!probe || !!probe.error || (!!state.clip && channel !== "clip")}
              title={probe?.error ?? "Play"}
              onClick={() => play(channel, asset)}
            >
              <div className={`asset-thumb ${category === "clips" ? "clip-thumb" : "audio-thumb"}`}>
                {category === "clips" ? (
                  <video
                    src={asset.url}
                    muted
                    preload="metadata"
                    playsInline
                    className="clip-thumbnail"
                  />
                ) : category === "music" ? (
                  <Music size={23} />
                ) : (
                  <Volume2 size={23} />
                )}
                <span className="asset-duration">
                  {probe?.error ? "Unavailable" : probe ? durationText(probe.duration) : "Loading…"}
                </span>
                {active && (
                  <span className="selected-check">
                    <Check size={11} />
                  </span>
                )}
              </div>
              <span>{asset.name}</span>
              {probe?.error && <small className="error">{probe.error}</small>}
            </button>
          );
        })}
      </div>
      {!byCategory(category).length && empty(category)}
      {playback(channel, state[channel])}
    </>
  );
  return (
    <aside className="media-panel">
      <div className="panel-header">
        <div>
          <Layers size={17} />
          <strong>Media library</strong>
        </div>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Refresh media library"
          disabled={busy}
          onClick={() => void refresh()}
        >
          <RefreshCw size={16} className={busy ? "spin" : ""} />
        </Button>
      </div>
      {preview && (
        <div className="panel-note">
          Preview mode · folder media becomes available after server setup.
        </div>
      )}
      <section className="media-section">
        <h3>
          Logo
          <ChevronDown size={15} />
        </h3>
        <div className="asset-grid logos">
          {byCategory("logos").map((a) => (
            <button
              className={`asset-card ${state.logo.assetId === a.id ? "selected" : ""}`}
              key={a.id}
              onClick={() =>
                execute({
                  type: "logo",
                  assetId: a.id,
                  visible: state.logo.assetId === a.id ? !state.logo.visible : true,
                  placement: state.logo.placement,
                })
              }
            >
              <div className="asset-thumb checker">
                <img src={a.url} alt="" />
              </div>
              <span>{a.name}</span>
            </button>
          ))}
        </div>
        {!byCategory("logos").length && empty("logos")}
        <div className="media-options">
          <span>Placement</span>
          <div className="segmented">
            {(["left", "right"] as const).map((placement) => (
              <button
                key={placement}
                aria-label={`Logo top ${placement}`}
                className={placement === state.logo.placement ? "active" : ""}
                onClick={() => execute({ type: "logo", ...state.logo, placement })}
              >
                <Image
                  size={15}
                  style={{ transform: placement === "right" ? "scaleX(-1)" : undefined }}
                />
              </button>
            ))}
          </div>
          {state.logo.assetId && (
            <Switch
              checked={state.logo.visible}
              onCheckedChange={(visible) => execute({ type: "logo", ...state.logo, visible })}
              label="Show logo"
            />
          )}
        </div>
      </section>
      <section className="media-section">
        <h3>
          Overlay
          <ChevronDown size={15} />
        </h3>
        <div className="setting-line compact">
          <Switch
            checked={state.overlay.fade}
            onCheckedChange={(fade) => execute({ type: "overlay", ...state.overlay, fade })}
            label="Fade overlays"
          />
          <span>Fade on show / hide</span>
        </div>
        <div className="asset-grid">
          {byCategory("overlays").map((a) => (
            <button
              className={`asset-card ${state.overlay.assetId === a.id && state.overlay.visible ? "selected" : ""}`}
              key={a.id}
              onClick={() =>
                execute({
                  type: "overlay",
                  assetId: a.id,
                  visible: state.overlay.assetId === a.id ? !state.overlay.visible : true,
                  fade: state.overlay.fade,
                })
              }
            >
              <div className="asset-thumb checker">
                <img src={a.url} alt="" />
              </div>
              <span>{a.name}</span>
            </button>
          ))}
        </div>
        {!byCategory("overlays").length && empty("overlays")}
      </section>
      <section className="media-section">
        <h3>
          Video clips
          <ChevronDown size={15} />
        </h3>
        {mediaCards("clips", "clip")}
        <p className="hint">
          Clips take over the stage and pause music. Intro and outro play when you click them.
        </p>
      </section>
      <section className="media-section">
        <h3>
          Background
          <ChevronDown size={15} />
        </h3>
        <div className="asset-grid">
          {Object.entries(gradients).map(([key, value]) => (
            <button
              key={key}
              className={`asset-card ${state.background.value === key ? "selected" : ""}`}
              onClick={() =>
                execute({ type: "background", background: { kind: "gradient", value: key } })
              }
            >
              <div className="asset-thumb" style={{ background: value }} />
              <span>{key.charAt(0).toUpperCase() + key.slice(1)}</span>
            </button>
          ))}
          {byCategory("backgrounds").map((a) => (
            <button
              key={a.id}
              className={`asset-card ${state.background.value === a.id ? "selected" : ""}`}
              onClick={() =>
                execute({ type: "background", background: { kind: "image", value: a.id } })
              }
            >
              <div className="asset-thumb">
                <img src={a.url} alt="" />
              </div>
              <span>{a.name}</span>
            </button>
          ))}
        </div>
        <div className="media-options">
          <label className="color-label">
            <input
              aria-label="Solid background color"
              type="color"
              value={state.background.kind === "color" ? state.background.value : "#124ce8"}
              onChange={(e) =>
                execute({
                  type: "background",
                  background: { kind: "color", value: e.target.value },
                })
              }
            />
            Solid color
          </label>
        </div>
      </section>
      <section className="media-section">
        <h3>
          Music
          <ChevronDown size={15} />
        </h3>
        {mediaCards("music", "music")}
      </section>
      <section className="media-section">
        <h3>
          Sounds
          <ChevronDown size={15} />
        </h3>
        {mediaCards("sounds", "sound")}
      </section>
      <div className="library-footer">
        <Plus size={14} />
        <span>Add files to the media folders, then Refresh.</span>
      </div>
    </aside>
  );
}
