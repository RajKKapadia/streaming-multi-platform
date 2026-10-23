import { test, expect } from "bun:test";
import { mkdtemp, rm, readFile, writeFile, symlink, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { EgressInfo, EgressStatus } from "livekit-server-sdk";
import { initialState, type Encoding, type Recording } from "@studio/contracts";
import { RecordingService } from "../src/recordings";
import { createRecordingRequest, type Gateway } from "../src/livekit";
import { Auth } from "../src/auth";
import { loadConfig } from "../src/config";
import { StudioService } from "../src/service";
import { MediaLibrary } from "../src/media";
import { createApp } from "../src/app";

class RecordingGateway implements Gateway {
  jobs: EgressInfo[] = [];
  state = initialState();
  stops: string[] = [];
  offline = false;
  stopEnding = false;
  async ensureRoom() {
    return this.state;
  }
  async readState() {
    return this.state;
  }
  async publishState(_room: string, state: typeof this.state) {
    this.state = state;
  }
  async participants() {
    return [];
  }
  async token() {
    return "token";
  }
  async start(): Promise<EgressInfo> {
    throw new Error("No RTMP output in recording tests.");
  }
  async startRecording(roomName: string, url: string, path: string, encoding: Encoding) {
    const job = new EgressInfo({
      egressId: `record-${this.jobs.length}`,
      roomName,
      status: EgressStatus.EGRESS_ACTIVE,
      request: { case: "egress", value: createRecordingRequest(roomName, url, path, encoding) },
    });
    this.jobs.push(job);
    return job;
  }
  async list() {
    if (this.offline) throw new Error("provider network outage");
    return this.jobs;
  }
  async stop(id: string) {
    this.stops.push(id);
    this.jobs.find((job) => job.egressId === id)!.status = this.stopEnding
      ? EgressStatus.EGRESS_ENDING
      : EgressStatus.EGRESS_COMPLETE;
  }
}
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "studio-recording-"));
  const config = {
    ...loadConfig({}),
    recordingsRoot: root,
    egressRecordingsRoot: root,
    recordingsEnabled: true,
    recordingRendererUrl: "http://127.0.0.1:3001",
    secret: "test-private-recording-signing-secret-with-enough-length",
    passcode: "test-passcode",
  };
  const gateway = new RecordingGateway();
  const auth = new Auth(config.secret);
  return { root, config, gateway, auth, service: new RecordingService(config, gateway, auth) };
}
function ffmpeg(args: string[]) {
  const result = spawnSync("ffmpeg", [
    "-nostdin",
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    ...args,
  ]);
  if (result.status !== 0) throw new Error(result.stderr.toString());
}
async function media(record: Recording, seconds = 4) {
  // Real H.264 + AAC segments, without devices, LiveKit, or streaming destinations.
  ffmpeg([
    "-f",
    "lavfi",
    "-i",
    "testsrc2=size=160x90:rate=10",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:sample_rate=48000",
    "-t",
    String(seconds),
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-g",
    "20",
    "-c:a",
    "aac",
    "-f",
    "hls",
    "-hls_time",
    "2",
    "-hls_list_size",
    "0",
    "-hls_segment_filename",
    join(record.directory, "segment_%05d.ts"),
    join(record.directory, "recording.m3u8"),
  ]);
}
async function exported(service: RecordingService): Promise<Recording> {
  for (let attempt = 0; attempt < 100; attempt++) {
    const record = (await service.snapshot("personal")).recordings[0]!;
    if (record.exportStatus === "failed") throw new Error(record.error);
    if (record.exportStatus === "ready") return record;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Export timed out");
}
test("recording request saves two-second HLS segments with no streaming output", () => {
  const request = createRecordingRequest(
    "studio-personal",
    "https://renderer.example",
    "/recordings/course",
    { width: 1920, height: 1080, fps: 60, bitrate: 17000 },
  );
  expect(request.outputs).toHaveLength(1);
  const output = request.outputs[0]!.config;
  expect(output.case).toBe("segments");
  if (output.case !== "segments") throw new Error("Wrong output");
  expect(output.value.playlistName).toBe("/recordings/course/recording.m3u8");
  expect(output.value.segmentDuration).toBe(2);
  expect(output.value.output.case).toBeUndefined();
});
test("local recording uses the internal API renderer while cloud recording needs explicit shared-storage setup", () => {
  const local = loadConfig({
    LIVEKIT_URL: "ws://127.0.0.1:7880",
    PORT: "3187",
    PUBLIC_APP_URL: "https://old-tunnel.example",
  });
  expect(local.recordingsEnabled).toBe(true);
  expect(local.recordingRendererUrl).toBe("http://127.0.0.1:3187");
  expect(loadConfig({ LIVEKIT_URL: "wss://example.livekit.cloud" }).recordingsEnabled).toBe(false);
  expect(
    loadConfig({ LIVEKIT_URL: "ws://localhost:7880", RECORDINGS_ENABLED: "false" })
      .recordingsEnabled,
  ).toBe(false);
});
test("continuous segments, Save so far, restart, delayed stop and final MP4 retain video and audio", async () => {
  const f = await fixture();
  try {
    const started = await f.service.start("personal", {
      name: "Lesson 1",
      folder: "courses/lesson-01",
    });
    const record = started.recordings[0]!;
    expect(record.directory).toStartWith(join(f.root, "courses/lesson-01/personal"));
    expect(record.status).toBe("recording");
    await media(record);
    const saved = (await f.service.snapshot("personal")).recordings[0]!;
    expect(saved.savedSeconds).toBe(4);
    expect(saved.savedBytes).toBeGreaterThan(0);
    await f.service.export("personal", record.id);
    const first = await exported(f.service);
    expect(first.exportedSeconds).toBe(4);
    expect(f.gateway.stops).toEqual([]);
    const result = await f.service.download("personal", record.id);
    const probe = spawnSync("ffprobe", [
      "-v",
      "error",
      "-show_streams",
      "-show_format",
      "-of",
      "json",
      result.path,
    ]);
    const info = JSON.parse(probe.stdout.toString());
    expect(info.streams.map((s: { codec_type: string }) => s.codec_type)).toEqual([
      "video",
      "audio",
    ]);
    expect(Number(info.format.duration)).toBeGreaterThanOrEqual(4);
    const restarted = new RecordingService(f.config, f.gateway, f.auth);
    expect((await restarted.snapshot("personal")).recordings[0]!.status).toBe("recording");
    f.gateway.stopEnding = true;
    await restarted.stop("personal", record.id);
    expect((await restarted.snapshot("personal")).recordings[0]!.status).toBe("stopping");
    await media(record, 6);
    f.gateway.jobs[0]!.status = EgressStatus.EGRESS_COMPLETE;
    await restarted.snapshot("personal");
    const final = await exported(restarted);
    expect(final.status).toBe("finished");
    expect(final.exportedSeconds).toBe(6);
    expect((await readdir(record.directory)).filter((name) => name.endsWith(".ts"))).toHaveLength(
      3,
    );
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
}, 20000);
test("interrupted recordings recover saved segments after an API restart and preserve originals on export failure", async () => {
  const f = await fixture();
  try {
    const record = (await f.service.start("personal", { name: "Recover me", folder: "" }))
      .recordings[0]!;
    await media(record);
    f.gateway.jobs[0]!.status = EgressStatus.EGRESS_ABORTED;
    const failed = new RecordingService(
      { ...f.config, ffmpegPath: "/missing-ffmpeg" },
      f.gateway,
      f.auth,
    );
    expect((await failed.snapshot("personal")).recordings[0]!.status).toBe("interrupted");
    await failed.export("personal", record.id);
    for (let i = 0; i < 50; i++) {
      if ((await failed.snapshot("personal")).recordings[0]!.exportStatus === "failed") break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect((await failed.snapshot("personal")).recordings[0]!.exportStatus).toBe("failed");
    expect((await readdir(record.directory)).filter((name) => name.endsWith(".ts"))).toHaveLength(
      2,
    );
    const restarted = new RecordingService(f.config, f.gateway, f.auth);
    await restarted.export("personal", record.id);
    expect((await exported(restarted)).exportedSeconds).toBe(4);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
}, 20000);
test("concurrent starts, unavailable provider, path traversal, symlinks, and studio boundaries are guarded", async () => {
  const f = await fixture();
  try {
    await expect(
      f.service.start("personal", { name: "Bad path", folder: "../outside" }),
    ).rejects.toThrow("subfolder");
    await symlink(tmpdir(), join(f.root, "linked"));
    await expect(
      f.service.start("personal", { name: "Bad link", folder: "linked" }),
    ).rejects.toThrow("symbolic");
    const attempts = await Promise.allSettled([
      f.service.start("personal", { name: "One", folder: "" }),
      f.service.start("personal", { name: "Two", folder: "" }),
    ]);
    expect(attempts.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(f.gateway.jobs).toHaveLength(1);
    const record = (await f.service.snapshot("personal")).recordings[0]!;
    f.gateway.offline = true;
    expect((await f.service.snapshot("personal")).recordings[0]!.status).toBe("recording");
    await expect(f.service.start("personal", { name: "Duplicate", folder: "" })).rejects.toThrow(
      "current recording",
    );
    expect((await f.service.snapshot("other")).recordings).toHaveLength(0);
    await expect(f.service.download("other", record.id)).rejects.toThrow("Export");
    await writeFile(
      join(record.directory, "recording.m3u8"),
      "#EXTM3U\n#EXTINF:2,\n../../secret.ts\n#EXTINF:2,\nhttps://example.com/segment.ts\n",
    );
    expect((await f.service.snapshot("personal")).recordings[0]!.segments).toBe(0);
    // Streaming controls must ignore independent recording jobs, even on API restart.
    f.gateway.offline = false;
    const studio = new StudioService(
      f.config,
      f.gateway,
      f.auth,
      new MediaLibrary(f.config.mediaRoot),
    );
    expect((await studio.status("personal")).live).toBe(false);
    await studio.stop("personal");
    expect(f.gateway.stops).toEqual([]);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});
test("host-only recording routes reject guests, render tokens, cross-studio cookies and invalid IDs", async () => {
  const f = await fixture();
  const { app, recordings } = createApp(f.config, f.gateway);
  const server = app.listen(0, "127.0.0.1");
  try {
    await new Promise<void>((resolve, reject) => {
      server.on("listening", resolve);
      server.on("error", reject);
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing test server");
    const base = `http://127.0.0.1:${address.port}/api/studios/personal/recordings`;
    const token = (role: "host" | "guest" | "renderer", studio = "personal") =>
      f.auth.sign({
        role,
        studio,
        identity: role,
        name: role,
        purpose: role === "renderer" ? "render" : "session",
        expires: Date.now() + 60_000,
      });
    const request = (
      suffix: string,
      method: string,
      cookie: string,
      body: unknown = { name: "Test", folder: "" },
    ) =>
      fetch(base + suffix, {
        method,
        headers: { Cookie: `studio-session=${cookie}`, "Content-Type": "application/json" },
        ...(method === "POST" ? { body: JSON.stringify(body) } : {}),
      });
    for (const role of ["guest", "renderer"] as const) {
      const expected = role === "renderer" ? 401 : 403;
      expect((await request("", "GET", token(role))).status).toBe(expected);
      expect((await request("/start", "POST", token(role))).status).toBe(expected);
      expect(
        (
          await request("/clear", "POST", token(role), {
            confirmed: true,
            ids: [crypto.randomUUID()],
          })
        ).status,
      ).toBe(expected);
      expect((await request(`/${crypto.randomUUID()}/download`, "GET", token(role))).status).toBe(
        expected,
      );
    }
    expect((await fetch(`${base}?access=${encodeURIComponent(token("renderer"))}`)).status).toBe(
      403,
    );
    expect((await request("", "GET", token("host", "other"))).status).toBe(401);
    expect((await request("/not-a-uuid/stop", "POST", token("host"))).status).toBe(400);
    expect((await request("", "GET", token("host"))).status).toBe(200);
    const response = await request("/start", "POST", token("host"));
    expect(response.status).toBe(200);
    const snapshot = await response.json();
    expect(snapshot.recordings[0].status).toBe("recording");
    expect(JSON.stringify(snapshot)).not.toContain("egressId");
    const record = snapshot.recordings[0] as Recording;
    await media(record);
    await recordings.export("personal", record.id);
    await exported(recordings);
    const download = await request(`/${record.id}/download`, "GET", token("host"));
    expect(download.status).toBe(200);
    expect(download.headers.get("content-disposition")).toContain("attachment");
    expect(Buffer.from(await download.arrayBuffer())).toEqual(
      await readFile(join(record.directory, "recording.mp4")),
    );
    // Index is persisted outside public media; the API response has no renderer capability.
    expect(
      await readFile(
        join(f.root, ".index", "personal", `${snapshot.recordings[0].id}.json`),
        "utf8",
      ),
    ).toContain("record-0");
    expect((await request("/clear", "POST", token("host"), { ids: [record.id] })).status).toBe(400);
    expect(
      (await request("/clear", "POST", token("host"), { confirmed: true, ids: [record.id] }))
        .status,
    ).toBe(400);
    await recordings.stop("personal", record.id);
    const cleared = await request("/clear", "POST", token("host"), {
      confirmed: true,
      ids: [record.id],
    });
    expect(cleared.status).toBe(200);
    expect((await cleared.json()).recordings).toEqual([]);
    await expect(stat(record.directory)).rejects.toMatchObject({ code: "ENOENT" });
  } finally {
    server.close();
    await rm(f.root, { recursive: true, force: true });
  }
});

async function completed(service: RecordingService, studio = "personal", folder = "") {
  const record = (await service.start(studio, { name: `Cleanup ${studio}`, folder }))
    .recordings[0]!;
  await service.stop(studio, record.id);
  return record;
}

test("cleanup removes the confirmed recording folders and history while preserving newer recordings, other studios and unrelated files", async () => {
  const f = await fixture();
  try {
    const first = await completed(f.service, "personal", "courses/lesson-01");
    const second = await completed(f.service, "personal", "courses/lesson-02");
    for (const record of [first, second]) {
      await writeFile(join(record.directory, "recording.mp4"), "exported video");
      await writeFile(join(record.directory, "segment_00001.ts"), "saved segment");
      await writeFile(join(record.directory, "export-interrupted.partial.mp4"), "partial export");
    }
    const other = await completed(f.service, "other", "courses/lesson-01");
    await writeFile(join(other.directory, "recording.mp4"), "other studio video");
    // This recording appeared after the confirmation list was captured.
    const newer = await completed(f.service);
    await writeFile(join(f.root, "keep.txt"), "unrelated file");
    const cleared = await f.service.clear("personal", [first.id, second.id]);
    expect(cleared.recordings.map((r) => r.id)).toEqual([newer.id]);
    for (const record of [first, second]) {
      await expect(stat(record.directory)).rejects.toMatchObject({ code: "ENOENT" });
      await expect(
        stat(join(f.root, ".index/personal", `${record.id}.json`)),
      ).rejects.toMatchObject({ code: "ENOENT" });
    }
    expect(await readFile(join(other.directory, "recording.mp4"), "utf8")).toBe(
      "other studio video",
    );
    expect(await readFile(join(f.root, "keep.txt"), "utf8")).toBe("unrelated file");
    expect((await stat(f.root)).isDirectory()).toBe(true);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test("cleanup rejects active, stopping and exporting recordings on the server", async () => {
  const f = await fixture();
  try {
    const record = (await f.service.start("personal", { name: "Busy recording", folder: "" }))
      .recordings[0]!;
    await expect(f.service.clear("personal", [record.id])).rejects.toThrow("Stop recording");
    f.gateway.stopEnding = true;
    await f.service.stop("personal", record.id);
    await expect(f.service.clear("personal", [record.id])).rejects.toThrow("Stop recording");
    f.gateway.jobs[0]!.status = EgressStatus.EGRESS_COMPLETE;
    await f.service.snapshot("personal");
    const index = join(f.root, ".index/personal", `${record.id}.json`);
    const manifest = JSON.parse(await readFile(index, "utf8"));
    await writeFile(index, JSON.stringify({ ...manifest, exportStatus: "exporting" }));
    await expect(f.service.clear("personal", [record.id])).rejects.toThrow("MP4 exports");
    expect((await stat(record.directory)).isDirectory()).toBe(true);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test("cleanup validates all paths and studio IDs before deleting anything and does not follow symlinks", async () => {
  const f = await fixture();
  const outside = await mkdtemp(join(tmpdir(), "recording-cleanup-outside-"));
  try {
    const first = await completed(f.service);
    const second = await completed(f.service);
    await writeFile(join(first.directory, "recording.mp4"), "keep until confirmed");
    await writeFile(join(outside, "keep.txt"), "outside data");
    await expect(f.service.clear("other", [first.id])).rejects.toThrow("list changed");
    await expect(f.service.clear("personal", [first.id, crypto.randomUUID()])).rejects.toThrow(
      "list changed",
    );
    const index = join(f.root, ".index/personal", `${second.id}.json`);
    const manifest = JSON.parse(await readFile(index, "utf8"));
    await writeFile(index, JSON.stringify({ ...manifest, relativeDirectory: "personal" }));
    await expect(f.service.clear("personal", [first.id, second.id])).rejects.toThrow(
      "Invalid recording folder",
    );
    expect(await readFile(join(first.directory, "recording.mp4"), "utf8")).toBe(
      "keep until confirmed",
    );
    await writeFile(index, JSON.stringify(manifest));
    await rm(second.directory, { recursive: true });
    await symlink(outside, second.directory);
    await expect(f.service.clear("personal", [first.id, second.id])).rejects.toThrow(
      "symbolic links",
    );
    expect(await readFile(join(first.directory, "recording.mp4"), "utf8")).toBe(
      "keep until confirmed",
    );
    expect(await readFile(join(outside, "keep.txt"), "utf8")).toBe("outside data");
  } finally {
    await rm(f.root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});
