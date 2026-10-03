import { useState } from "react";
import { Camera, Mic, Sparkles, Settings as SettingsIcon, Headphones } from "lucide-react";
import { Dialog, Button, Select, Switch } from "@studio/ui";
import { VideoTrack } from "@studio/rendering";
import { usePreferences } from "./store";
import { applyDevices, type Capture } from "./devices";
import type { Asset } from "@studio/contracts";
export function Settings({
  open,
  onClose,
  capture,
  assets,
}: {
  open: boolean;
  onClose: () => void;
  capture: Capture;
  assets: Asset[];
}) {
  const p = usePreferences(),
    [tab, setTab] = useState("camera"),
    [error, setError] = useState(""),
    [saving, setSaving] = useState(false);
  const settings = capture.camera?.mediaStreamTrack.getSettings();
  const save = async () => {
    setSaving(true);
    setError("");
    try {
      await applyDevices(capture.camera, capture.microphone, assets);
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
      title="Settings"
      description="Choose devices and camera effects."
      className="settings-dialog"
    >
      <div className="settings-body">
        <nav className="settings-nav">
          {[
            { id: "camera", name: "Camera", Icon: Camera },
            { id: "audio", name: "Audio", Icon: Mic },
            { id: "effects", name: "Visual effects", Icon: Sparkles },
            { id: "general", name: "General", Icon: SettingsIcon },
          ].map(({ id, name, Icon }) => (
            <button key={id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}>
              <Icon size={17} />
              {name}
            </button>
          ))}
        </nav>
        <div className="settings-content">
          <div className="settings-preview">
            {capture.camera ? (
              <VideoTrack track={capture.camera} mirror={p.mirror} />
            ) : (
              <Camera size={40} />
            )}
          </div>
          {tab === "camera" && (
            <>
              <div className="field-row">
                <label>
                  Camera
                  <Select value={p.cameraId} onChange={(e) => p.set({ cameraId: e.target.value })}>
                    <option value="">Default camera</option>
                    {capture.devices
                      .filter((d) => d.kind === "videoinput")
                      .map((d) => (
                        <option key={d.deviceId} value={d.deviceId}>
                          {d.label || "Camera"}
                        </option>
                      ))}
                  </Select>
                </label>
                <label>
                  Capture resolution
                  <Select
                    value={p.resolution}
                    onChange={(e) => p.set({ resolution: e.target.value as "1080" })}
                  >
                    <option value="1080">Full HD (1080p)</option>
                    <option value="720">HD (720p)</option>
                    <option value="480">Standard (480p)</option>
                  </Select>
                </label>
              </div>
              <label>
                Capture frame rate
                <Select
                  value={p.fps}
                  onChange={(e) => p.set({ fps: Number(e.target.value) as 30 | 60 })}
                >
                  <option value="60">60 fps requested</option>
                  <option value="30">30 fps requested</option>
                </Select>
              </label>
              <div className="setting-line">
                <Switch
                  checked={p.mirror}
                  onCheckedChange={(mirror) => p.set({ mirror })}
                  label="Mirror my camera"
                />
                <span>Mirror my camera preview</span>
              </div>
              <p className="hint">
                Actual capture:{" "}
                {settings
                  ? `${settings.width} × ${settings.height} · ${Math.round(settings.frameRate ?? 0)} fps`
                  : "Enable your camera to inspect its actual settings."}
              </p>
            </>
          )}
          {tab === "audio" && (
            <>
              <label>
                Microphone
                <Select
                  value={p.microphoneId}
                  onChange={(e) => p.set({ microphoneId: e.target.value })}
                >
                  <option value="">Default microphone</option>
                  {capture.devices
                    .filter((d) => d.kind === "audioinput")
                    .map((d) => (
                      <option key={d.deviceId} value={d.deviceId}>
                        {d.label || "Microphone"}
                      </option>
                    ))}
                </Select>
              </label>
              <div className="setting-line">
                <Switch
                  checked={p.echo}
                  onCheckedChange={(echo) => p.set({ echo })}
                  label="Echo cancellation"
                />
                <span>Echo cancellation</span>
              </div>
              <p className="hint">
                <Headphones size={15} /> Wear headphones when inviting guests or monitoring effects.
              </p>
            </>
          )}
          {tab === "effects" && (
            <>
              <label>
                Camera effect
                <Select
                  value={p.effect}
                  onChange={(e) => p.set({ effect: e.target.value as "none" })}
                >
                  <option value="none">None</option>
                  <option value="blur">Background blur</option>
                  <option value="image">Virtual background</option>
                </Select>
              </label>
              {p.effect === "image" && (
                <label>
                  Background image
                  <Select
                    value={p.backgroundId}
                    onChange={(e) => p.set({ backgroundId: e.target.value })}
                  >
                    <option value="">Choose an image</option>
                    {assets
                      .filter((a) => a.category === "backgrounds")
                      .map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))}
                  </Select>
                </label>
              )}
              <p className="hint">
                Camera effects are included in your published video. Add images to media/backgrounds
                and Refresh in the studio.
              </p>
            </>
          )}
          {tab === "general" && (
            <p className="hint">
              Program output: 1920 × 1080 at 60 fps. Cameras and source clips keep their original
              motion cadence. Your display name and device preferences are saved on this browser.
            </p>
          )}
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          <div className="dialog-actions">
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={save} disabled={saving}>
              {saving ? "Applying…" : "Apply settings"}
            </Button>
          </div>
        </div>
      </div>
    </Dialog>
  );
}
