import { useEffect, useState } from "react";
import { Radio, Eye, EyeOff, ExternalLink } from "lucide-react";
import { Button, Dialog, Input, Select, Switch } from "@studio/ui";
import {
  defaultDestinationURLs,
  defaultPlatformEncoding,
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
          url: defaultDestinationURLs[platform],
          hasKey: false,
          encoding: defaultPlatformEncoding(platform),
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
            {selected === "twitch"
              ? "Copy your Primary Stream key from Twitch → Settings → Stream. The server address is supplied automatically. Twitch goes live when it receives your video."
              : selected === "youtube"
                ? "Open YouTube Studio → Go live → Stream and copy the stream key for your broadcast. The standard secure server address is supplied automatically."
                : "Create or select a source in X Live Studio, then copy that source’s server URL and secret stream key into the separate fields below."}
          </p>
          {selected === "x" ? (
            <label>
              RTMP / RTMPS server URL
              <Input
                value={current.url}
                placeholder="Your X source server URL (without the stream key)"
                disabled={!!status?.live}
                onChange={(e) => change({ url: e.target.value })}
              />
            </label>
          ) : (
            <details className="destination-server" key={selected}>
              <summary>Advanced server settings · optional</summary>
              <label>
                RTMP / RTMPS server URL
                <Input
                  value={current.url}
                  placeholder={defaultDestinationURLs[selected]}
                  disabled={!!status?.live}
                  onChange={(e) => change({ url: e.target.value })}
                />
              </label>
              <p className="hint">
                Leave blank to use the standard server, or paste a custom ingest address.
              </p>
            </details>
          )}
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
                value={`${current.encoding.height}p${current.encoding.fps}`}
                disabled={!!status?.live}
                onChange={(e) =>
                  change({
                    encoding: {
                      ...current.encoding,
                      width: e.target.value.startsWith("720") ? 1280 : 1920,
                      height: e.target.value.startsWith("720") ? 720 : 1080,
                      fps: e.target.value.endsWith("30") ? 30 : 60,
                    },
                  })
                }
              >
                {selected === "x" ? (
                  <>
                    <option value="720p60">720p60 · smoother motion (recommended)</option>
                    <option value="1080p30">1080p30 · sharper detail</option>
                    <option value="720p30">720p30 · lower encoding load</option>
                  </>
                ) : (
                  <option value="1080p60">1080p60</option>
                )}
              </Select>
            </label>
            <label>
              Video bitrate (kbps)
              <Input
                type="number"
                min={2500}
                max={selected === "x" ? 12000 : 20000}
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
            <span>H.264 Main · AAC 128 kbps · 48 kHz · {selected === "x" ? 3 : 2}s keyframes</span>
          </div>
          {selected !== "twitch" && (
            <p className="platform-note">
              {selected === "x"
                ? "720p60 gives smoother motion on X when your camera, screen share, or clip supplies 60 fps. Choose 1080p30 for finer detail or 720p30 for lower encoding load. Save, then Start streaming here and confirm the preview in X Live Studio before going live."
                : "Enable YouTube, save, then click Start streaming here. YouTube’s immediate Stream tab starts when video arrives. For scheduled broadcasts, wait for the preview, then click Go live or use Auto-start. If YouTube stays Preparing or No data, check that its selected stream key matches this destination and inspect Stream health. Confirm playback on the YouTube watch page."}
            </p>
          )}
          {status?.groups.flatMap((g) =>
            g.destinations
              .filter((d) => d.platform === selected)
              .map((d, i) => (
                <p className={`output-status ${d.status}`} key={`${g.id}-${i}`}>
                  <span className="tiny-dot" />
                  {d.status === "active" ? "Sending video" : d.status} · {g.encoding.height}p
                  {g.encoding.fps}
                  {d.error && <span>{d.error}</span>}
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
                  : "https://x.com/i/live-studio"
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
