import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, Mic, Sparkles, Settings as SettingsIcon, Headphones } from "lucide-react";
import { Dialog, Button, Input, Select, Switch } from "@studio/ui";
import { VideoTrack } from "@studio/rendering";
import { usePreferences } from "./store";
import { applyDevices, type Capture } from "./devices";
import type { Asset } from "@studio/contracts";
export function Settings({
  open,
  onClose,
  capture,
  loadBackgrounds,
  autoEnableCamera = false,
}: {
  open: boolean;
  onClose: () => void;
  capture: Capture;
  loadBackgrounds: () => Promise<Asset[]>;
  autoEnableCamera?: boolean;
}) {
  const p = usePreferences(),
    [tab, setTab] = useState("camera"),
    [error, setError] = useState(""),
    [backgrounds, setBackgrounds] = useState<Asset[]>([]),
    [backgroundsError, setBackgroundsError] = useState(""),
    [loadingBackgrounds, setLoadingBackgrounds] = useState(false),
    [loadingImage, setLoadingImage] = useState(false),
    [saving, setSaving] = useState(false);
  const backgroundRequest = useRef(0);
  const backgroundLoader = useRef(loadBackgrounds);
  backgroundLoader.current = loadBackgrounds;
  const settings = capture.camera?.mediaStreamTrack.getSettings();
  const refreshBackgrounds = useCallback(async () => {
    const request = ++backgroundRequest.current;
    setLoadingBackgrounds(true);
    setBackgroundsError("");
    try {
      const assets = await backgroundLoader.current();
      if (request === backgroundRequest.current)
        setBackgrounds(assets.filter((a) => a.category === "backgrounds"));
    } catch (e) {
      if (request === backgroundRequest.current)
        setBackgroundsError(
          e instanceof Error ? e.message : "The background library could not be loaded.",
        );
    } finally {
      if (request === backgroundRequest.current) setLoadingBackgrounds(false);
    }
  }, []);
  useEffect(() => {
    if (!open) return;
    setBackgrounds([]);
    void refreshBackgrounds();
    return () => {
      backgroundRequest.current++;
    };
  }, [open, refreshBackgrounds]);
  const previewEffect = () => {
    setError("");
    if (usePreferences.getState().effect === "none") return;
    if (autoEnableCamera && (!capture.camera || capture.camera.isMuted))
      void capture.enable("camera");
    else if (!capture.camera) setError("Enable your camera to preview a camera effect.");
  };
  const chooseImage = async (file?: File) => {
    if (!file) return;
    setLoadingImage(true);
    setError("");
    let url: string | undefined;
    try {
      if (!["image/png", "image/jpeg", "image/webp"].includes(file.type))
        throw new Error("Choose a PNG, JPEG, or WebP image.");
      url = URL.createObjectURL(file);
      const image = new Image();
      image.src = url;
      await image.decode();
      p.set({ backgroundId: "", localBackground: { url, name: file.name } });
      previewEffect();
    } catch (e) {
      if (url) URL.revokeObjectURL(url);
      setError(e instanceof Error ? e.message : "The background image could not be opened.");
    } finally {
      setLoadingImage(false);
    }
  };
  const save = async () => {
    setSaving(true);
    setError("");
    try {
      if (
        p.effect === "image" &&
        !p.localBackground &&
        !backgrounds.some((a) => a.id === p.backgroundId)
      )
        throw new Error("Choose a background image from your computer or the media library.");
      const camera =
        capture.camera ??
        (autoEnableCamera && p.effect !== "none" ? await capture.enable("camera") : undefined);
      if (p.effect !== "none" && !camera)
        throw new Error("Enable your camera to apply a camera effect. Check camera permissions.");
      await applyDevices(camera, capture.microphone);
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
                  aria-label="Camera effect"
                  disabled={saving}
                  onChange={(e) => {
                    p.set({ effect: e.target.value as "none" });
                    previewEffect();
                  }}
                >
                  <option value="none">None</option>
                  <option value="blur">Background blur</option>
                  <option value="image">Virtual background</option>
                </Select>
              </label>
              {p.effect === "blur" && (
                <label>
                  <span className="blur-label">
                    Blur amount <output>{p.blurRadius}</output>
                  </span>
                  <input
                    type="range"
                    min={1}
                    max={30}
                    step={1}
                    value={p.blurRadius}
                    aria-label="Blur amount"
                    disabled={saving}
                    onChange={(e) => {
                      p.set({ blurRadius: Number(e.target.value) });
                      previewEffect();
                    }}
                  />
                  <span className="blur-scale">
                    <span>Light</span>
                    <span>Strong</span>
                  </span>
                </label>
              )}
              {p.effect === "image" && (
                <>
                  <label>
                    Background image
                    <Select
                      value={p.localBackground ? "local" : p.backgroundId}
                      aria-label="Background image"
                      disabled={
                        loadingImage ||
                        saving ||
                        loadingBackgrounds ||
                        (!p.localBackground && !backgrounds.length)
                      }
                      onChange={(e) => {
                        if (e.target.value !== "local") {
                          p.set({ backgroundId: e.target.value, localBackground: null });
                          previewEffect();
                        }
                      }}
                    >
                      <option value="">
                        {loadingBackgrounds
                          ? "Loading backgrounds…"
                          : backgrounds.length
                            ? "Choose an image"
                            : backgroundsError
                              ? "Background library unavailable"
                              : "No library images available"}
                      </option>
                      {p.localBackground && <option value="local">{p.localBackground.name}</option>}
                      {backgrounds.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))}
                    </Select>
                  </label>
                  <Button
                    variant="secondary"
                    disabled={loadingBackgrounds || saving}
                    onClick={() => void refreshBackgrounds()}
                  >
                    {loadingBackgrounds ? "Loading backgrounds…" : "Refresh backgrounds"}
                  </Button>
                  {backgroundsError && (
                    <p role="alert" className="error">
                      {backgroundsError}
                    </p>
                  )}
                  <label>
                    Choose image from computer
                    <Input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      disabled={loadingImage || saving}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        e.target.value = "";
                        void chooseImage(file);
                      }}
                    />
                  </label>
                  <p className="hint">
                    {loadingImage
                      ? "Opening image…"
                      : "PNG, JPEG, or WebP. Local images stay selected until you reload the page."}
                  </p>
                </>
              )}
              <p className="hint">
                Effects update your preview immediately and are included in your published video.
                After adding library images, click Refresh backgrounds to update the list.
              </p>
              {capture.applyingEffect && (
                <p role="status" className="hint">
                  Updating preview…
                </p>
              )}
            </>
          )}
          {tab === "general" && (
            <p className="hint">
              Program output: 1920 × 1080 at 60 fps. Cameras and source clips keep their original
              motion cadence. Your display name and device preferences are saved on this browser.
            </p>
          )}
          {(error || capture.effectError || capture.error) && (
            <p role="alert" className="error">
              {error || capture.effectError || capture.error}
            </p>
          )}
          <div className="dialog-actions">
            <Button variant="secondary" onClick={onClose}>
              Close
            </Button>
            <Button
              onClick={save}
              disabled={
                saving ||
                capture.busy ||
                capture.applyingEffect ||
                loadingImage ||
                (p.effect === "image" && !p.localBackground && loadingBackgrounds)
              }
            >
              {saving ? "Applying…" : "Apply settings"}
            </Button>
          </div>
        </div>
      </div>
    </Dialog>
  );
}
