import { useEffect, useState } from "react";
import { Radio, Eye, EyeOff, ExternalLink } from "lucide-react";
import { Button, Dialog, Input, Select, Switch } from "@studio/ui";
import {
  defaultEncoding,
  platformIds,
  type Destination,
  type PublicDestination,
  type BroadcastStatus,
} from "@studio/contracts";
import { api, studioPath } from "./api";
export const platformNames = { youtube: "YouTube", twitch: "Twitch", x: "X (Twitter)" };
export function PlatformMark({ platform }: { platform: "youtube" | "twitch" | "x" }) {
  return (
    <span className={`platform-mark ${platform}`} aria-hidden="true">
      {platform === "youtube" ? "▶" : platform === "twitch" ? "▣" : "𝕏"}
    </span>
  );
}
export function Destinations({
  open,
  onClose,
  studioId,
  preview,
  status,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  studioId: string;
  preview: boolean;
  status: BroadcastStatus | null;
  onSaved: () => void;
}) {
  const [destinations, setDestinations] = useState<(PublicDestination & { key?: string })[]>([]),
    [selected, setSelected] = useState<"youtube" | "twitch" | "x">("youtube"),
    [error, setError] = useState(""),
    [saving, setSaving] = useState(false),
    [reveal, setReveal] = useState(false);
  useEffect(() => {
    if (!open) return;
    setError("");
    if (preview)
      setDestinations(
        platformIds.map((platform) => ({
          platform,
          enabled: false,
          url: "",
          hasKey: false,
          encoding: { ...defaultEncoding },
        })),
      );
    else
      void api<PublicDestination[]>(studioPath(studioId, "destinations"))
        .then(setDestinations)
        .catch((e) => setError(e.message));
    return () => {
      setDestinations([]);
      setReveal(false);
    };
  }, [open, studioId, preview]);
  const current = destinations.find((d) => d.platform === selected);
  const change = (data: Partial<PublicDestination & { key: string }>) =>
    setDestinations((ds) => ds.map((d) => (d.platform === selected ? { ...d, ...data } : d)));
  const save = async () => {
    setSaving(true);
    setError("");
    try {
      if (preview)
        throw new Error(
          "Configure the server and enter the studio to save streaming destinations.",
        );
      await api<PublicDestination[]>(
        studioPath(studioId, "destinations"),
        destinations.map(({ hasKey: _hasKey, ...d }) => d) as Destination[],
        "PUT",
      );
      onSaved();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
      title="Streaming destinations"
      description="Send your program to your audience."
      className="destinations-dialog"
    >
      <div className="destination-tabs">
        {platformIds.map((platform) => (
          <button
            key={platform}
            onClick={() => {
              setSelected(platform);
              setReveal(false);
            }}
            className={selected === platform ? "selected" : ""}
          >
            <PlatformMark platform={platform} />
            <span>{platformNames[platform]}</span>
            {destinations.find((d) => d.platform === platform)?.enabled && (
              <span className="enabled-dot" />
            )}
          </button>
        ))}
      </div>
      {current && (
        <div className="destination-form">
          <div className="destination-enable">
            <strong>{platformNames[selected]}</strong>
            <div className="setting-line">
              <span>Enabled</span>
              <Switch
                checked={current.enabled}
                onCheckedChange={(enabled) => change({ enabled })}
                label={`Enable ${platformNames[selected]}`}
                disabled={!!status?.live}
              />
            </div>
          </div>
          <p className="hint">
            Create a broadcast in your platform dashboard, then copy its ingest URL and stream key.
          </p>
          <label>
            RTMP / RTMPS server URL
            <Input
              value={current.url}
              placeholder={
                selected === "youtube"
                  ? "rtmps://a.rtmps.youtube.com/live2"
                  : selected === "twitch"
                    ? "rtmp://live.twitch.tv/app"
                    : "Your X Producer ingest URL"
              }
              disabled={!!status?.live}
              onChange={(e) => change({ url: e.target.value })}
            />
          </label>
          <label>
            Stream key
            <div className="key-input">
              <Input
                aria-label="Stream key"
                type={reveal ? "text" : "password"}
                autoComplete="off"
                value={current.key ?? ""}
                placeholder={
                  current.hasKey ? "Saved on server · leave blank to keep" : "Enter stream key"
                }
                disabled={!!status?.live}
                onChange={(e) => change({ key: e.target.value })}
              />
              <button
                aria-label={reveal ? "Hide stream key" : "Show stream key"}
                onClick={() => setReveal(!reveal)}
              >
                {reveal ? <EyeOff size={17} /> : <Eye size={17} />}
              </button>
            </div>
          </label>
          <div className="field-row">
            <label>
              Output profile
              <Select
                value={current.encoding.fps}
                disabled={!!status?.live}
                onChange={(e) =>
                  change({
                    encoding: { ...current.encoding, fps: Number(e.target.value) as 30 | 60 },
                  })
                }
              >
                <option value="60">1080p60</option>
                {selected === "x" && <option value="30">1080p30 · X compatibility</option>}
              </Select>
            </label>
            <label>
              Video bitrate (kbps)
              <Input
                type="number"
                min={2500}
                max={20000}
                step={500}
                value={current.encoding.bitrate}
                disabled={!!status?.live}
                onChange={(e) =>
                  change({ encoding: { ...current.encoding, bitrate: Number(e.target.value) } })
                }
              />
            </label>
          </div>
          <div className="encoding-note">
            <Radio size={16} />
            <span>H.264 Main · AAC 128 kbps · 48 kHz · 2s keyframes</span>
          </div>
          {selected === "x" && (
            <p className="platform-note">
              Test X with your actual account. If its ingest rejects 60 fps, select the 30 fps
              compatibility profile. Other outputs stay at 60 fps.
            </p>
          )}
          {status?.groups.flatMap((g) =>
            g.destinations
              .filter((d) => d.platform === selected)
              .map((d, i) => (
                <p className={`output-status ${d.status}`} key={`${g.id}-${i}`}>
                  <span className="tiny-dot" />
                  {d.status} · {g.encoding.fps} fps{d.error && <span>{d.error}</span>}
                </p>
              )),
          )}
          <a
            className="text-link"
            target="_blank"
            rel="noreferrer"
            href={
              selected === "youtube"
                ? "https://studio.youtube.com"
                : selected === "twitch"
                  ? "https://dashboard.twitch.tv"
                  : "https://producer.x.com"
            }
          >
            Open {platformNames[selected]} dashboard
            <ExternalLink size={13} />
          </a>
        </div>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="dialog-actions">
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
        <Button disabled={saving || !!status?.live} onClick={() => void save()}>
          {saving ? "Saving…" : "Save destinations"}
        </Button>
      </div>
    </Dialog>
  );
}
