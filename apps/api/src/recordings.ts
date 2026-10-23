import {
  open,
  mkdir,
  chmod,
  readFile,
  readdir,
  rename,
  lstat,
  realpath,
  rm,
  rmdir,
} from "node:fs/promises";
import { join, posix, resolve, relative, isAbsolute, dirname } from "node:path";
import { spawn } from "node:child_process";
import { z } from "zod";
import { EgressStatus, type EgressInfo } from "livekit-server-sdk";
import type { Recording, RecordingInput, RecordingsSnapshot } from "@studio/contracts";
import type { Config } from "./config";
import type { Auth } from "./auth";
import { activeEgress, RendererUnavailableError, type Gateway } from "./livekit";

const manifestSchema = z.object({
  version: z.literal(1),
  id: z.string().uuid(),
  studio: z.string().regex(/^[a-z0-9-]{1,64}$/),
  name: z.string().min(1).max(100),
  relativeDirectory: z.string().regex(/^[a-zA-Z0-9_/-]+$/),
  egressId: z.string().optional(),
  status: z.enum(["starting", "recording", "stopping", "finished", "interrupted", "failed"]),
  startedAt: z.number(),
  endedAt: z.number().optional(),
  exportStatus: z.enum(["none", "exporting", "ready", "failed"]),
  exportedSeconds: z.number().optional(),
  error: z.string().optional(),
});
type Manifest = z.infer<typeof manifestSchema>;
type Segment = { file: string; duration: number; size: number };
const pending = (r: Manifest) => ["starting", "recording", "stopping"].includes(r.status);

export class RecordingError extends Error {}

// Egress and the API share RECORDINGS_ROOT. Only closed segments referenced by the
// event playlist are used for exports. Originals are retained until confirmed cleanup.
export class RecordingService {
  private queues = new Map<string, Promise<unknown>>();
  private exports = new Map<string, Promise<void>>();
  private maintaining = false;
  constructor(
    private config: Config,
    private gateway: Gateway,
    private auth: Auth,
  ) {}

  private async serial<T>(studio: string, work: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(studio) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(work);
    this.queues.set(studio, next);
    try {
      return await next;
    } finally {
      if (this.queues.get(studio) === next) this.queues.delete(studio);
    }
  }

  async snapshot(studio: string): Promise<RecordingsSnapshot> {
    return this.serial(studio, async () => {
      const records = await this.reconcile(studio);
      return {
        enabled: this.config.recordingsEnabled,
        root: this.config.recordingsRoot,
        recordings: await Promise.all(
          records.map(async (r) => {
            const segments = await this.segments(r);
            const {
              version: _version,
              studio: _studio,
              egressId: _egressId,
              relativeDirectory,
              ...publicRecord
            } = r;
            const output: Recording = {
              ...publicRecord,
              directory: resolve(this.config.recordingsRoot, relativeDirectory),
              segments: segments.length,
              savedSeconds: segments.reduce((total, s) => total + s.duration, 0),
              savedBytes: segments.reduce((total, s) => total + s.size, 0),
            };
            if (r.exportStatus === "ready" && (await this.safeFile(r, "recording.mp4")))
              output.downloadUrl = `/api/studios/${studio}/recordings/${r.id}/download`;
            return output;
          }),
        ),
      };
    });
  }

  async start(studio: string, input: RecordingInput) {
    await this.serial(studio, async () => {
      if (!this.config.recordingsEnabled)
        throw new RecordingError(
          "Recording requires self-hosted Egress with a shared recordings folder. See the recording setup in README.",
        );
      const records = await this.reconcile(studio);
      if (records.some(pending))
        throw new RecordingError("Stop the current recording before starting another.");
      // Verify FFmpeg before asking Egress to start. No recording data is held in RAM.
      try {
        await run(this.config.ffmpegPath, ["-version"]);
      } catch {
        throw new RecordingError(
          "Install FFmpeg on the API machine or set FFMPEG_PATH before recording.",
        );
      }
      const folder = input.folder.replace(/\\/g, "/");
      if (folder && (!/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*$/.test(folder) || folder.length > 200))
        throw new RecordingError(
          "Choose a recording subfolder using letters, numbers, hyphens, underscores, and slashes.",
        );
      const id = crypto.randomUUID();
      const r: Manifest = {
        version: 1,
        id,
        studio,
        name: input.name,
        relativeDirectory: posix.join(folder, studio, id),
        status: "starting",
        startedAt: Date.now(),
        exportStatus: "none",
      };
      await this.directory(r.relativeDirectory, true);
      await this.save(r);
      const capability = this.auth.sign({
        role: "renderer",
        studio,
        identity: "renderer",
        name: "Recording renderer",
        expires: Date.now() + 24 * 3600_000,
        purpose: "render",
      });
      const url = `${this.config.recordingRendererUrl}/broadcast/${studio}?access=${encodeURIComponent(capability)}`;
      try {
        const job = await this.gateway.startRecording(
          `studio-${studio}`,
          url,
          this.egressDirectory(r),
          {
            width: 1920,
            height: 1080,
            fps: 60,
            bitrate: 17000,
            keyframeInterval: 2,
          },
        );
        r.egressId = job.egressId;
        this.update(r, job);
        await this.save(r);
      } catch (error) {
        // A network timeout can happen after the provider accepted StartEgress.
        // Keep the reservation and rediscover by output path before allowing retry.
        if (error instanceof RendererUnavailableError) {
          r.status = "failed";
          r.endedAt = Date.now();
          r.error =
            "The recording renderer is unreachable. Build the web app and check RECORDING_RENDERER_URL.";
        } else {
          r.error =
            "Recording start is unconfirmed. Refresh status before retrying; check Egress and its shared folder.";
        }
        await this.save(r);
        throw new RecordingError(r.error);
      }
    });
    return this.snapshot(studio);
  }

  async stop(studio: string, id: string) {
    await this.serial(studio, async () => {
      const r = (await this.reconcile(studio)).find((r) => r.id === id);
      if (!r) throw new RecordingError("The recording was not found.");
      if (!pending(r)) return;
      if (!r.egressId)
        throw new RecordingError(
          "Recording start is still unconfirmed. Refresh status and try again.",
        );
      try {
        await this.gateway.stop(r.egressId);
      } catch {
        throw new RecordingError(
          "The recording could not be stopped. Check LiveKit connectivity and try again.",
        );
      }
      // StopEgress acknowledges the request; the final playlist can still be flushing.
      r.status = "stopping";
      await this.save(r);
    });
    return this.snapshot(studio);
  }

  async export(studio: string, id: string) {
    await this.serial(studio, async () => {
      const r = (await this.reconcile(studio)).find((r) => r.id === id);
      if (!r) throw new RecordingError("The recording was not found.");
      if (this.exports.has(id)) return;
      const segments = await this.segments(r);
      if (!segments.length)
        throw new RecordingError(
          "No completed segments are saved yet. Wait a few seconds and try again.",
        );
      if (r.status === "starting" || r.status === "stopping")
        throw new RecordingError(
          "Wait for recording startup or stopping to finish before exporting.",
        );
      await this.beginExport(r, segments);
    });
    return this.snapshot(studio);
  }

  async download(studio: string, id: string) {
    const r = (await this.records(studio)).find((r) => r.id === id);
    if (!r || r.exportStatus !== "ready")
      throw new RecordingError("Export this recording before downloading it.");
    const path = await this.safeFile(r, "recording.mp4");
    if (!path)
      throw new RecordingError("The recording export is missing. Export the saved segments again.");
    return { path, name: `${r.name.replace(/[^a-zA-Z0-9_-]/g, "_") || "recording"}.mp4` };
  }

  async clear(studio: string, ids: string[]) {
    await this.serial(studio, async () => {
      // Read without reconcile: cleanup must not start an automatic export just
      // before deleting it. Starts, exports and maintenance share this studio lock.
      const records = await this.records(studio);
      if (
        records.some((r) => pending(r) || r.exportStatus === "exporting" || this.exports.has(r.id))
      )
        throw new RecordingError(
          "Stop recording and wait for all MP4 exports to finish before clearing recordings.",
        );
      const selected = ids.map((id) => records.find((r) => r.id === id));
      if (!ids.length || new Set(ids).size !== ids.length || selected.some((r) => !r))
        throw new RecordingError(
          "The recording list changed. Refresh it and confirm cleanup again.",
        );
      // Validate every target before deleting anything. Never remove the base
      // folder, another studio's files, or a path supplied by the HTTP client.
      const targets: { record: Manifest; directory?: string }[] = [];
      for (const record of selected as Manifest[]) {
        const suffix = `${studio}/${record.id}`;
        if (
          record.relativeDirectory !== posix.normalize(record.relativeDirectory) ||
          !(record.relativeDirectory === suffix || record.relativeDirectory.endsWith(`/${suffix}`))
        )
          throw new RecordingError("Invalid recording folder. Cleanup was cancelled.");
        try {
          targets.push({
            record,
            directory: await this.directory(record.relativeDirectory, false),
          });
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
          targets.push({ record });
        }
      }
      const base = await realpath(this.config.recordingsRoot);
      const index = await this.directory(`.index/${studio}`, false);
      for (const target of targets) {
        if (target.directory) await rm(target.directory, { recursive: true, force: true });
        // Keep the manifest if deletion failed, so the user can retry cleanup.
        await rm(join(index, `${target.record.id}.json`), { force: true });
        if (target.directory) {
          let parent = dirname(target.directory);
          while (parent !== base) {
            try {
              await rmdir(parent);
            } catch {
              break;
            } // Only empty parent folders are removed.
            parent = dirname(parent);
          }
        }
      }
    });
    return this.snapshot(studio);
  }

  async maintain() {
    if (this.maintaining) return;
    this.maintaining = true;
    try {
      const index = await this.directory(".index", false);
      for (const entry of await readdir(index, { withFileTypes: true })) {
        if (entry.isDirectory() && /^[a-z0-9-]{1,64}$/.test(entry.name))
          await this.serial(entry.name, () => this.reconcile(entry.name));
      }
    } catch {
      /* No recordings yet, or storage temporarily unavailable. UI requests surface failures. */
    } finally {
      this.maintaining = false;
    }
  }

  private async reconcile(studio: string) {
    const records = await this.records(studio);
    let jobs: EgressInfo[] | undefined;
    if (records.some(pending)) {
      try {
        jobs = await this.gateway.list(`studio-${studio}`);
      } catch {
        /* A provider outage must not mark a running job interrupted or permit a duplicate. */
      }
    }
    for (const r of records) {
      if (pending(r) && jobs) {
        const job = jobs.find(
          (job) =>
            job.egressId === r.egressId ||
            recordingPlaylist(job) === `${this.egressDirectory(r)}/recording.m3u8`,
        );
        if (job) {
          r.egressId = job.egressId;
          this.update(r, job);
        } else if (Date.now() - r.startedAt > 60_000) {
          r.status = "interrupted";
          r.endedAt = Date.now();
          r.error =
            "The recorder is no longer running. Export the completed segments to recover what was saved.";
        }
        await this.save(r);
      }
      if (r.exportStatus === "exporting" && !this.exports.has(r.id)) {
        r.exportStatus = "failed";
        r.error =
          "MP4 export was interrupted. The saved segments are retained; export again to recover them.";
        await this.save(r);
      }
      if (r.status === "finished" && (r.exportStatus === "none" || r.exportStatus === "ready")) {
        const segments = await this.segments(r);
        const seconds = segments.reduce((sum, s) => sum + s.duration, 0);
        if (
          segments.length &&
          (r.exportStatus === "none" || seconds > (r.exportedSeconds || 0) + 0.01)
        )
          await this.beginExport(r, segments);
      }
    }
    return records.sort((a, b) => b.startedAt - a.startedAt);
  }

  private update(r: Manifest, job: EgressInfo) {
    if (activeEgress(job)) {
      r.status =
        job.status === EgressStatus.EGRESS_ENDING || r.status === "stopping"
          ? "stopping"
          : job.status === EgressStatus.EGRESS_ACTIVE
            ? "recording"
            : "starting";
      if (r.exportStatus !== "failed") r.error = undefined;
    } else {
      r.endedAt ??= Date.now();
      r.status = [EgressStatus.EGRESS_COMPLETE, EgressStatus.EGRESS_LIMIT_REACHED].includes(
        job.status,
      )
        ? "finished"
        : "interrupted";
      if (r.status === "interrupted")
        r.error =
          "The recorder stopped unexpectedly. Completed segments are retained and can be exported.";
    }
  }

  private async beginExport(r: Manifest, segments: Segment[]) {
    r.exportStatus = "exporting";
    r.error = undefined;
    await this.save(r);
    const task = this.makeMP4(r, segments)
      .then(
        () =>
          this.serial(r.studio, async () => {
            const latest = (await this.records(r.studio)).find((item) => item.id === r.id)!;
            latest.exportStatus = "ready";
            latest.exportedSeconds = segments.reduce((sum, s) => sum + s.duration, 0);
            latest.error = undefined;
            await this.save(latest);
          }),
        () =>
          this.serial(r.studio, async () => {
            const latest = (await this.records(r.studio)).find((item) => item.id === r.id)!;
            latest.exportStatus = "failed";
            latest.error =
              "MP4 export failed. Check free disk space and FFmpeg, then retry. Saved segments have been kept.";
            await this.save(latest);
          }),
      )
      .catch(() => {
        /* Preserve segments even if the index disk itself becomes unavailable. */
      });
    this.exports.set(r.id, task);
    void task.finally(() => this.exports.delete(r.id));
  }

  private async makeMP4(r: Manifest, segments: Segment[]) {
    const directory = await this.directory(r.relativeDirectory, false);
    // A finite, private playlist freezes the snapshot without interrupting Egress.
    const playlist = [
      "#EXTM3U",
      "#EXT-X-VERSION:3",
      "#EXT-X-TARGETDURATION:10",
      "#EXT-X-MEDIA-SEQUENCE:0",
      ...segments.flatMap((s) => [`#EXTINF:${s.duration},`, s.file]),
      "#EXT-X-ENDLIST",
      "",
    ].join("\n");
    const attempt = crypto.randomUUID();
    const input = join(directory, `export-${attempt}.m3u8`);
    const partial = join(directory, `export-${attempt}.partial.mp4`);
    await this.atomic(input, playlist);
    try {
      await run(this.config.ffmpegPath, [
        "-nostdin",
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-protocol_whitelist",
        "file,crypto,data",
        "-i",
        input,
        "-map",
        "0:v:0",
        "-map",
        "0:a:0?",
        "-c",
        "copy",
        "-bsf:a",
        "aac_adtstoasc",
        "-movflags",
        "+faststart",
        partial,
      ]);
      const output = await open(partial, "r");
      try {
        await output.sync();
      } finally {
        await output.close();
      }
      await rename(partial, join(directory, "recording.mp4"));
    } finally {
      await Promise.all([rm(partial, { force: true }), rm(input, { force: true })]);
    }
  }

  private egressDirectory(r: Manifest) {
    return posix.join(this.config.egressRecordingsRoot, r.relativeDirectory);
  }

  private async records(studio: string): Promise<Manifest[]> {
    let index: string;
    try {
      index = await this.directory(`.index/${studio}`, false);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    const records: Manifest[] = [];
    for (const entry of await readdir(index, { withFileTypes: true })) {
      if (!entry.isFile() || !/^[a-f0-9-]{36}\.json$/.test(entry.name)) continue;
      try {
        const r = manifestSchema.parse(JSON.parse(await readFile(join(index, entry.name), "utf8")));
        if (r.studio === studio && entry.name === `${r.id}.json`) records.push(r);
      } catch {
        /* A damaged manifest must not hide other recordings. Files remain on disk. */
      }
    }
    return records;
  }

  private async save(r: Manifest) {
    const directory = await this.directory(`.index/${r.studio}`, true);
    await this.atomic(join(directory, `${r.id}.json`), JSON.stringify(r));
  }

  private async atomic(file: string, content: string) {
    const temporary = `${file}.${crypto.randomUUID()}.tmp`;
    const handle = await open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(content);
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await rename(temporary, file);
    } finally {
      await rm(temporary, { force: true });
    }
  }

  private async directory(path: string, create: boolean): Promise<string> {
    const root = this.config.recordingsRoot;
    if (create) await mkdir(root, { recursive: true, mode: 0o770 });
    const base = await realpath(root);
    const suffix = relative(root, resolve(root, path));
    if (isAbsolute(suffix) || suffix.startsWith(".."))
      throw new RecordingError("Invalid recording folder.");
    let current = base;
    for (const component of suffix.split(/[\\/]/).filter(Boolean)) {
      current = join(current, component);
      if (create) {
        try {
          await mkdir(current, { mode: 0o770 });
          // Preserve group write despite the API process's umask. Compose adds this
          // group to the Egress worker, which runs as a different unprivileged UID.
          await chmod(current, 0o770);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        }
      }
      const info = await lstat(current);
      if (!info.isDirectory() || info.isSymbolicLink())
        throw new RecordingError("Recording folders cannot contain symbolic links.");
    }
    return current;
  }

  private async safeFile(r: Manifest, filename: string) {
    try {
      const directory = await this.directory(r.relativeDirectory, false);
      const path = join(directory, filename);
      const info = await lstat(path);
      return info.isFile() && !info.isSymbolicLink() ? path : null;
    } catch {
      return null;
    }
  }

  private async segments(r: Manifest): Promise<Segment[]> {
    const path = await this.safeFile(r, "recording.m3u8");
    if (!path) return [];
    const directory = dirname(path);
    const text = await readFile(path, "utf8");
    const segments: Segment[] = [];
    let duration = 0;
    for (const line of text.split(/\r?\n/).map((s) => s.trim())) {
      if (line.startsWith("#EXTINF:")) duration = Number(line.slice(8).split(",")[0]);
      else if (line && !line.startsWith("#")) {
        if (duration > 0 && Number.isFinite(duration) && /^segment[a-zA-Z0-9_-]*\.ts$/.test(line)) {
          try {
            const info = await lstat(join(directory, line));
            if (info.isFile() && !info.isSymbolicLink() && info.size > 0)
              segments.push({ file: line, duration, size: info.size });
          } catch {
            /* A segment missing from disk cannot be counted or exported. */
          }
        }
        duration = 0;
      }
    }
    return segments;
  }
}

function recordingPlaylist(job: EgressInfo) {
  const request = job.request;
  if (request.case === "egress")
    return request.value.outputs.flatMap((o) =>
      o.config.case === "segments" ? [o.config.value.playlistName] : [],
    )[0];
  if (request.case === "roomComposite") return request.value.segmentOutputs[0]?.playlistName;
  return undefined;
}

function run(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "ignore", timeout: 10 * 60_000 });
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error("Recording subprocess failed.")),
    );
  });
}
