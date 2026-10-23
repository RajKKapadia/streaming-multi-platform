import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Circle, Download, Square, Trash2 } from "lucide-react";
import { Button, Dialog, Input } from "@studio/ui";
import type { Recording, RecordingsSnapshot } from "@studio/contracts";
import { api, studioPath } from "./api";

export function useRecordings(studioId: string, enabled: boolean) {
  const [snapshot, setSnapshot] = useState<RecordingsSnapshot | null>(null);
  const [error, setError] = useState("");
  const refresh = useCallback(async () => {
    if (!enabled) return;
    try {
      setSnapshot(await api<RecordingsSnapshot>(studioPath(studioId, "recordings")));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, [enabled, studioId]);
  useEffect(() => {
    if (!enabled) return;
    void refresh();
    const timer = setInterval(() => void refresh(), 2500);
    return () => clearInterval(timer);
  }, [enabled, refresh]);
  return { snapshot, setSnapshot, error, refresh };
}

export function recordingActive(r: Recording) {
  return ["starting", "recording", "stopping"].includes(r.status);
}
function duration(seconds: number) {
  const n = Math.max(0, Math.floor(seconds));
  return `${Math.floor(n / 3600)
    .toString()
    .padStart(2, "0")}:${Math.floor((n / 60) % 60)
    .toString()
    .padStart(2, "0")}:${(n % 60).toString().padStart(2, "0")}`;
}

export function Recordings({
  open,
  onClose,
  studioId,
  preview,
  connected,
  title,
  data,
}: {
  open: boolean;
  onClose: () => void;
  studioId: string;
  preview: boolean;
  connected: boolean;
  title: string;
  data: ReturnType<typeof useRecordings>;
}) {
  const [name, setName] = useState(title);
  const [folder, setFolder] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [cleanup, setCleanup] = useState<Recording[] | null>(null);
  const cleanupActions = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (cleanup) cleanupActions.current?.querySelector("button")?.focus();
  }, [cleanup]);
  const { snapshot, setSnapshot } = data;
  const active = snapshot?.recordings.find(recordingActive);
  const cleanupBlocked =
    !!busy || !!active || !!snapshot?.recordings.some((r) => r.exportStatus === "exporting");
  const confirmCleanup = async () => {
    if (busy || !cleanup) return;
    setBusy("clear");
    setError("");
    try {
      setSnapshot(
        await api<RecordingsSnapshot>(studioPath(studioId, "recordings/clear"), {
          confirmed: true,
          ids: cleanup.map((recording) => recording.id),
        }),
      );
      setCleanup(null);
    } catch (e) {
      setError((e as Error).message);
      void data.refresh();
    } finally {
      setBusy("");
    }
  };
  const action = async (path: string, body: unknown = {}) => {
    if (busy) return;
    setBusy(path);
    setError("");
    try {
      setSnapshot(await api<RecordingsSnapshot>(studioPath(studioId, path), body));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  };
  const saveAs = async (recording: Recording) => {
    if (!recording.downloadUrl || busy) return;
    type Picker = (options: {
      suggestedName: string;
      types: { description: string; accept: Record<string, string[]> }[];
    }) => Promise<FileSystemFileHandle>;
    const picker = (window as Window & { showSaveFilePicker?: Picker }).showSaveFilePicker;
    if (!picker) {
      window.location.assign(recording.downloadUrl);
      return;
    }
    setBusy(`save-${recording.id}`);
    setError("");
    let writer: FileSystemWritableFileStream | undefined;
    try {
      const handle = await picker.call(window, {
        suggestedName: `${recording.name.replace(/[<>:"/\\|?*]/g, "_")}.mp4`,
        types: [{ description: "MP4 video", accept: { "video/mp4": [".mp4"] } }],
      });
      const response = await fetch(recording.downloadUrl, { credentials: "same-origin" });
      if (!response.ok || !response.body)
        throw new Error("The recording could not be downloaded. Try again.");
      writer = await handle.createWritable();
      await response.body.pipeTo(writer);
    } catch (e) {
      await writer?.abort().catch(() => {});
      if ((e as Error).name !== "AbortError") setError((e as Error).message);
    } finally {
      setBusy("");
    }
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v && busy !== "clear") {
          setCleanup(null);
          onClose();
        }
      }}
      title={cleanup ? "Clear recording folders?" : "Recordings"}
      description={
        cleanup
          ? `Permanently delete ${cleanup.length} recording${cleanup.length === 1 ? "" : "s"} from this studio.`
          : "Record the full program, with or without streaming."
      }
      className="recordings-dialog"
    >
      {cleanup ? (
        <div className="recording-cleanup-warning">
          <p className="recording-cleanup-heading">
            <AlertTriangle size={19} aria-hidden="true" />
            <strong>This cannot be undone.</strong>
          </p>
          <p>
            Save a copy before continuing. This removes MP4 exports, recovery segments, playlists,
            and recording history from the folders below.
          </p>
          <ul aria-label="Recordings to delete">
            {cleanup.map((recording) => (
              <li key={recording.id}>
                <strong>{recording.name}</strong>
                <code className="recording-path">{recording.directory}</code>
              </li>
            ))}
          </ul>
          <p>Copies already saved elsewhere and other studios’ recordings are kept.</p>
          {cleanupBlocked && busy !== "clear" && (
            <p className="field-error" role="status">
              Wait for recording, exporting, or saving to finish before clearing.
            </p>
          )}
          {error && (
            <p className="field-error" role="alert">
              {error}
            </p>
          )}
        </div>
      ) : preview ? (
        <p className="hint">
          Connect your studio as host to record. Interface preview cannot record.
        </p>
      ) : (
        <>
          <div className="recording-storage">
            <strong>Continuous saving on the recording machine</strong>
            <code>{snapshot?.root || "Loading recording folder…"}</code>
            <p className="hint">
              Completed segments stay in this folder while recording. Stop creates an MP4. Save as
              copies the MP4 to a folder on your computer.
            </p>
          </div>
          {snapshot && !snapshot.enabled && (
            <p className="field-error" role="status">
              Recording needs self-hosted Egress and a shared recordings folder. Follow the
              recording setup in README, then restart the API.
            </p>
          )}
          {!active && (
            <form
              className="recording-form"
              onSubmit={(e) => {
                e.preventDefault();
                void action("recordings/start", { name, folder });
              }}
            >
              <label>
                Recording name
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  maxLength={100}
                />
              </label>
              <label>
                Subfolder (optional)
                <Input
                  value={folder}
                  onChange={(e) => setFolder(e.target.value)}
                  placeholder="courses/lesson-01"
                  maxLength={200}
                  pattern="[a-zA-Z0-9_/-]*"
                />
              </label>
              <p className="hint">
                Saved under the folder above, followed by the studio and a unique recording ID. Use
                letters, numbers, hyphens, underscores, and slashes.
              </p>
              <Button
                type="submit"
                disabled={!!busy || !snapshot?.enabled || !connected || !name.trim()}
              >
                <Circle size={15} />
                {busy === "recordings/start" ? "Starting…" : "Start recording"}
              </Button>
            </form>
          )}
          {(error || data.error) && (
            <p className="field-error" role="alert">
              {error || data.error}
            </p>
          )}
          <div className="recording-list" aria-label="Saved recordings">
            {snapshot?.recordings.map((recording) => (
              <article className="recording-card" key={recording.id}>
                <div className="recording-heading">
                  <strong>{recording.name}</strong>
                  <span
                    className={`recording-state ${recordingActive(recording) ? "recording-now" : ""}`}
                  >
                    {recording.status}
                  </span>
                </div>
                <p className="hint">
                  {new Date(recording.startedAt).toLocaleString()} · Saved{" "}
                  {duration(recording.savedSeconds)} · {recording.segments} segments ·{" "}
                  {(recording.savedBytes / 1024 / 1024).toFixed(1)} MB
                </p>
                <code className="recording-path">{recording.directory}</code>
                {recording.status === "starting" && (
                  <p className="hint">
                    Waiting for the recorder. Saved duration advances when segments reach disk.
                  </p>
                )}
                {recording.status === "interrupted" && (
                  <p className="hint">
                    Export completed segments to recover the saved portion. The final unfinished
                    segment may be missing.
                  </p>
                )}
                {recording.error && (
                  <p className="field-error" role="status">
                    {recording.error}
                  </p>
                )}
                {recording.exportStatus === "exporting" && (
                  <p className="hint" role="status">
                    Creating MP4… Saved segments are retained.
                  </p>
                )}
                {recording.exportStatus === "ready" && (
                  <p className="hint">
                    MP4 contains {duration(recording.exportedSeconds || 0)}
                    {recordingActive(recording) ? " · snapshot; recording continues" : ""}.
                  </p>
                )}
                <div className="recording-actions">
                  {recordingActive(recording) && (
                    <Button
                      size="sm"
                      variant="danger"
                      disabled={!!busy || recording.status === "stopping"}
                      onClick={() => void action(`recordings/${recording.id}/stop`)}
                    >
                      <Square size={13} />
                      {recording.status === "stopping" ? "Stopping…" : "Stop recording"}
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={
                      !!busy ||
                      !recording.segments ||
                      recording.exportStatus === "exporting" ||
                      ["starting", "stopping"].includes(recording.status)
                    }
                    onClick={() => void action(`recordings/${recording.id}/export`)}
                  >
                    {recordingActive(recording) ? "Save so far" : "Export saved segments"}
                  </Button>
                  {recording.downloadUrl && (
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={!!busy}
                      onClick={() => void saveAs(recording)}
                    >
                      <Download size={14} />
                      {busy === `save-${recording.id}` ? "Saving…" : "Save as…"}
                    </Button>
                  )}
                </div>
              </article>
            ))}
            {snapshot && !snapshot.recordings.length && (
              <p className="hint">No recordings yet. Streaming destinations are optional.</p>
            )}
          </div>
          <p className="hint">
            Recording continues if you close this dialog or leave the studio while sources remain
            connected. Stop recording explicitly when finished. Keep saved segments for recovery; a
            disk failure can still lose data.
          </p>
        </>
      )}
      <div className="dialog-footer" ref={cleanupActions}>
        {cleanup ? (
          <>
            <Button
              variant="secondary"
              disabled={busy === "clear"}
              onClick={() => {
                setCleanup(null);
                setError("");
              }}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              disabled={cleanupBlocked}
              onClick={() => void confirmCleanup()}
            >
              <Trash2 size={15} />
              {busy === "clear" ? "Clearing…" : "Delete permanently"}
            </Button>
          </>
        ) : (
          <>
            {!preview && (
              <Button
                variant="danger"
                disabled={!snapshot?.recordings.length || cleanupBlocked}
                onClick={() => {
                  setError("");
                  setCleanup(snapshot!.recordings.slice(0, 500));
                }}
                title={
                  cleanupBlocked
                    ? "Finish recording, exporting, and saving before clearing."
                    : "Permanently delete this studio’s saved recording folders"
                }
              >
                <Trash2 size={15} />
                {(snapshot?.recordings.length || 0) > 500
                  ? "Clear 500 recordings…"
                  : "Clear recordings…"}
              </Button>
            )}
            <Button variant="secondary" onClick={onClose}>
              Close
            </Button>
          </>
        )}
      </div>
    </Dialog>
  );
}
