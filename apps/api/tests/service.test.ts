import { describe, test, expect } from "bun:test";
import { mkdtemp, mkdir, writeFile, symlink, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  EgressInfo,
  EgressStatus,
  StartEgressRequest,
  TemplateSource,
  EncodingOptions,
  Output,
  StreamOutput,
} from "livekit-server-sdk";
import {
  initialState,
  defaultEncoding,
  defaultPlatformEncoding,
  type StudioState,
  type ParticipantInfo,
  type Destination,
  type Role,
  type Encoding,
  messageHistoryLimit,
} from "@studio/contracts";
import { StudioService, validateURL } from "../src/service";
import { Auth, matchesPasscode } from "../src/auth";
import { MediaLibrary } from "../src/media";
import type { Gateway } from "../src/livekit";
import type { Config } from "../src/config";
import { createApp } from "../src/app";
export const config: Config = {
  port: 0,
  publicUrl: "https://studio.example.com",
  passcode: "private-test-passcode",
  secret: "a-private-test-signing-secret-at-least-32-characters",
  livekitUrl: "wss://test.example.com",
  apiKey: "test",
  apiSecret: "test",
  mediaRoot: "/tmp/nonexistent-studio-media",
  webRoot: "/tmp/no-web",
  production: false,
};
export class FakeGateway implements Gateway {
  state = initialState();
  people: ParticipantInfo[] = [];
  jobs: EgressInfo[] = [];
  starts = 0;
  failFPS: number | null = null;
  stops: string[] = [];
  listed = true;
  async ensureRoom() {
    return structuredClone(this.state);
  }
  async readState() {
    return this.state;
  }
  async publishState(_name: string, s: StudioState) {
    this.state = structuredClone(s);
  }
  async participants() {
    return this.people;
  }
  async token(_room: string, identity: string, _name: string, _role: Role) {
    return `token-${identity}`;
  }
  async start(roomName: string, _url: string, urls: string[], encoding: Encoding) {
    this.starts++;
    if (this.failFPS === encoding.fps)
      throw new Error("Provider failure including private-stream-key");
    const job = new EgressInfo({
      egressId: `egress-${this.starts}`,
      roomName,
      status: EgressStatus.EGRESS_ACTIVE,
      streamResults: urls.map((url) => ({ url, status: 0 })),
      request: {
        case: "egress",
        value: new StartEgressRequest({
          roomName,
          source: { case: "template", value: new TemplateSource() },
          encoding: {
            case: "advanced",
            value: new EncodingOptions({
              width: encoding.width,
              height: encoding.height,
              framerate: encoding.fps,
              videoBitrate: encoding.bitrate,
              keyFrameInterval: encoding.keyframeInterval ?? 2,
            }),
          },
          outputs: [new Output({ config: { case: "stream", value: new StreamOutput({ urls }) } })],
        }),
      },
    });
    this.jobs.push(job);
    return job;
  }
  async list() {
    return this.listed ? this.jobs : [];
  }
  async stop(id: string) {
    this.stops.push(id);
    this.jobs.find((e) => e.egressId === id)!.status = EgressStatus.EGRESS_COMPLETE;
  }
}
function fixture(gateway = new FakeGateway()) {
  const auth = new Auth(config.secret);
  return {
    gateway,
    auth,
    service: new StudioService(config, gateway, auth, new MediaLibrary(config.mediaRoot)),
  };
}
function ds(): Destination[] {
  return ["youtube", "twitch", "x"].map((platform) => ({
    platform: platform as Destination["platform"],
    enabled: true,
    url: `rtmps://live.${platform}.example.com/app`,
    key: `private-${platform}-key`,
    encoding: { ...defaultEncoding, fps: platform === "x" ? 30 : 60 },
  }));
}
describe("access and media", () => {
  test("signed tokens enforce purpose, expiry and tamper resistance", () => {
    const a = new Auth(config.secret),
      claims = {
        role: "host" as const,
        studio: "personal",
        identity: "host",
        name: "Host",
        expires: Date.now() + 10000,
        purpose: "session" as const,
      };
    const token = a.sign(claims);
    expect(a.verify(token, ["session"])?.role).toBe("host");
    expect(a.verify(token, ["render"])).toBeNull();
    expect(a.verify(token + "x", ["session"])).toBeNull();
    expect(a.verify(a.sign({ ...claims, expires: 0 }), ["session"])).toBeNull();
    expect(matchesPasscode(config.passcode, "wrong")).toBe(false);
  });
  test("folder scanning and serving reject escaping symlinks and unsupported files", async () => {
    const root = await mkdtemp(join(tmpdir(), "studio-media-"));
    const outside = await mkdtemp(join(tmpdir(), "studio-outside-"));
    try {
      await mkdir(join(root, "logos"));
      await writeFile(join(root, "logos", "my-logo.png"), "image");
      await writeFile(join(root, "logos", "private.txt"), "secret");
      await writeFile(join(outside, "escape.png"), "outside");
      await symlink(join(outside, "escape.png"), join(root, "logos", "escape.png"));
      const media = new MediaLibrary(root),
        assets = await media.scan();
      expect(assets).toHaveLength(1);
      expect(assets[0]!.name).toBe("my logo");
      expect(await media.path("../private.txt")).toBeNull();
      await rm(join(root, "logos", "my-logo.png"));
      await symlink(join(outside, "escape.png"), join(root, "logos", "my-logo.png"));
      expect(await media.path(assets[0]!.id)).toBeNull();
    } finally {
      await rm(root, { recursive: true });
      await rm(outside, { recursive: true });
    }
  });
  test("guest reservations survive API restart and ignore renderer participants", async () => {
    const f = fixture();
    for (let i = 1; i <= 3; i++) await f.service.join("personal", `guest-${i}`, "Guest", "guest");
    const restarted = fixture(f.gateway);
    await expect(restarted.service.join("personal", "guest-4", "Fourth", "guest")).rejects.toThrow(
      "three guests",
    );
    f.gateway.people = [
      {
        identity: "host",
        name: "Host",
        role: "host",
        camera: true,
        microphone: true,
        screenSid: null,
      },
    ];
    await f.service.join("personal", "host", "Host", "host");
    expect(f.gateway.state.participants).toEqual(["host"]);
  });
});
describe("studio messages", () => {
  test("host and backstage guests share ordered history without changing program metadata", async () => {
    const f = fixture();
    f.gateway.people = ["host", "guest-1"].map((identity) => ({
      identity,
      name: identity === "host" ? "Host" : "Alex",
      role: identity === "host" ? "host" : "guest",
      camera: false,
      microphone: false,
      screenSid: null,
    }));
    const host = { identity: "host", name: "Host", role: "host" as const };
    const guest = { identity: "guest-1", name: "Alex", role: "guest" as const };
    const before = structuredClone(f.gateway.state);
    await f.service.sendMessage("personal", host, "  Ready?  ");
    await f.service.sendMessage("personal", guest, "Ready!\nMy camera is off.");
    const history = f.service.messages("personal");
    expect(history.messages.map((m) => m.text)).toEqual(["Ready?", "Ready!\nMy camera is off."]);
    expect(history.messages.map((m) => m.role)).toEqual(["host", "guest"]);
    expect(history.revision).toBe(2);
    expect(new Set(history.messages.map((m) => m.id)).size).toBe(2);
    expect(f.service.messages("other").messages).toEqual([]);
    expect(f.gateway.state).toEqual(before);
    await expect(f.service.sendMessage("personal", guest, "   ")).rejects.toThrow();
    await expect(f.service.sendMessage("personal", guest, "x".repeat(2001))).rejects.toThrow();
    f.gateway.people = [];
    await expect(f.service.sendMessage("personal", guest, "Disconnected")).rejects.toThrow(
      "reconnect",
    );
    expect(f.service.messages("personal").revision).toBe(2);
  });
  test("concurrent sends retain the most recent 100 messages and preserve prior snapshots", async () => {
    const f = fixture();
    f.gateway.people = [
      {
        identity: "host",
        name: "Host",
        role: "host",
        camera: false,
        microphone: false,
        screenSid: null,
      },
    ];
    const empty = f.service.messages("personal");
    await Promise.all(
      Array.from({ length: messageHistoryLimit + 5 }, (_, i) =>
        f.service.sendMessage(
          "personal",
          { identity: "host", name: "Host", role: "host" },
          `Message ${i}`,
        ),
      ),
    );
    const history = f.service.messages("personal");
    expect(history.messages).toHaveLength(messageHistoryLimit);
    expect(history.messages[0]!.text).toBe("Message 5");
    expect(history.messages.at(-1)!.text).toBe(`Message ${messageHistoryLimit + 4}`);
    expect(history.revision).toBe(messageHistoryLimit + 5);
    expect(empty.messages).toEqual([]);
    expect(history.sessionId).toBe(empty.sessionId);
    expect(fixture(f.gateway).service.messages("personal").sessionId).not.toBe(history.sessionId);
  });
});
describe("broadcast management", () => {
  test("Twitch and YouTube accept just a key and use their built-in servers", async () => {
    const f = fixture();
    await f.service.updateDestinations(
      "personal",
      ds().map((d) => ({
        ...d,
        enabled: d.platform !== "x",
        url: "  ",
        key: `  ${d.key}  `,
      })),
    );
    await f.service.start("personal");
    expect(f.gateway.starts).toBe(1);
    expect(f.gateway.jobs[0]!.streamResults.map((o) => o.url)).toEqual([
      "rtmps://a.rtmps.youtube.com:443/live2/private-youtube-key",
      "rtmp://live.twitch.tv/app/private-twitch-key",
    ]);
    expect(JSON.stringify(f.service.publicDestinations("personal"))).not.toContain("private-");
    await f.service.stop("personal");
    await expect(
      f.service.updateDestinations(
        "personal",
        ds().map((d) => ({
          ...d,
          url: "",
          enabled: d.platform === "x",
        })),
      ),
    ).rejects.toThrow("server URL from X");
  });
  test("custom ingest addresses and keys survive an unrelated destination save", async () => {
    const f = fixture();
    const destinations = ds().map((d) => ({ ...d, enabled: false }));
    await f.service.updateDestinations("personal", destinations);
    await f.service.updateDestinations("personal", f.service.publicDestinations("personal"));
    expect(f.service.destinations("personal").map((d) => ({ url: d.url, key: d.key }))).toEqual(
      destinations.map((d) => ({ url: d.url, key: d.key })),
    );
  });
  test("platform defaults start three independent encodes with their actual quality", async () => {
    const f = fixture();
    await f.service.updateDestinations(
      "personal",
      ds().map((d) => ({
        ...d,
        encoding: defaultPlatformEncoding(d.platform),
      })),
    );
    const status = await f.service.start("personal");
    expect(f.gateway.starts).toBe(3);
    const x = status.groups.find((g) => g.destinations.some((d) => d.platform === "x"))!;
    expect(x.encoding).toEqual(defaultPlatformEncoding("x"));
    expect(x.destinations).toHaveLength(1);
    for (const platform of ["youtube", "twitch"] as const) {
      const group = status.groups.find((g) => g.destinations.some((d) => d.platform === platform))!;
      expect(group.encoding).toEqual(defaultPlatformEncoding(platform));
      expect(group.destinations).toHaveLength(1);
    }
  });
  test("X rejects unsupported 1080p60, excessive bitrates, and mismatched dimensions", async () => {
    const f = fixture();
    const changeX = (encoding: Encoding) =>
      ds().map((d) => (d.platform === "x" ? { ...d, encoding } : d));
    await expect(
      f.service.updateDestinations(
        "personal",
        changeX({ ...defaultPlatformEncoding("x"), width: 1920, height: 1080 }),
      ),
    ).rejects.toThrow("1080p30 or 720p60");
    await expect(
      f.service.updateDestinations(
        "personal",
        changeX({ ...defaultPlatformEncoding("x"), bitrate: 12500 }),
      ),
    ).rejects.toThrow("12000");
    await expect(
      f.service.updateDestinations(
        "personal",
        changeX({ ...defaultPlatformEncoding("x"), height: 1080 }),
      ),
    ).rejects.toThrow("output profile");
    await expect(
      f.service.updateDestinations(
        "personal",
        ds().map((d) =>
          d.platform === "youtube" ? { ...d, encoding: defaultPlatformEncoding("x") } : d,
        ),
      ),
    ).rejects.toThrow("1080p60 profile");
    expect(f.gateway.starts).toBe(0);
  });
  test("aborted renderer startup is reported as failed with actionable, safe details", async () => {
    const f = fixture();
    await f.service.updateDestinations("personal", ds());
    await f.service.start("personal");
    for (const job of f.gateway.jobs) {
      job.status = EgressStatus.EGRESS_ABORTED;
      job.error = "Start signal not received";
      job.streamResults = [];
    }
    const status = await f.service.status("personal");
    expect(status.live).toBe(false);
    expect(status.groups.flatMap((g) => g.destinations)).toHaveLength(3);
    for (const output of status.groups.flatMap((g) => g.destinations)) {
      expect(output.status).toBe("failed");
      expect(output.error).toContain("program renderer did not become ready");
    }
    expect(JSON.stringify(status)).not.toContain("private-");
  });
  test("queued Egress outputs are shown as starting until capture is active", async () => {
    const f = fixture();
    await f.service.updateDestinations("personal", ds());
    await f.service.start("personal");
    for (const job of f.gateway.jobs) job.status = EgressStatus.EGRESS_STARTING;
    const status = await f.service.status("personal");
    expect(status.live).toBe(true);
    expect(status.groups.flatMap((g) => g.destinations).every((d) => d.status === "starting")).toBe(
      true,
    );
  });
  test("current Egress stream results report individual failures instead of assuming delivery", async () => {
    const f = fixture();
    await f.service.updateDestinations("personal", ds());
    await f.service.start("personal");
    const job = f.gateway.jobs[0]!;
    const results = job.streamResults;
    results[0]!.status = 2;
    results[0]!.error = "Provider error including private-youtube-key";
    job.streamResults = [];
    job.result = new EgressInfo({ result: { case: "stream", value: { info: results } } }).result;
    const status = await f.service.status("personal");
    const outputs = status.groups[0]!.destinations;
    expect(outputs.find((d) => d.platform === "youtube")?.status).toBe("failed");
    expect(outputs.find((d) => d.platform === "twitch")?.status).toBe("active");
    expect(outputs.find((d) => d.platform === "youtube")?.error).toContain("output failed");
    expect(JSON.stringify(status)).not.toContain("private-");
  });
  test("groups profiles, serializes duplicate starts and masks all keys", async () => {
    const f = fixture();
    await f.service.updateDestinations("personal", ds());
    const results = await Promise.all([f.service.start("personal"), f.service.start("personal")]);
    expect(f.gateway.starts).toBe(2);
    expect(results[0]!.groups).toHaveLength(2);
    expect(results[0]!.groups[0]!.destinations).toHaveLength(2);
    expect(JSON.stringify(results)).not.toContain("private-");
    expect(JSON.stringify(f.gateway.state)).not.toContain("key");
    expect(f.service.publicDestinations("personal")[0]!.hasKey).toBe(true);
  });
  test("start guards remain effective while the Egress list is delayed", async () => {
    const f = fixture();
    f.gateway.listed = false;
    await f.service.updateDestinations("personal", ds());
    await f.service.start("personal");
    await f.service.start("personal");
    expect(f.gateway.starts).toBe(2);
  });
  test("healthy profiles continue when another profile fails", async () => {
    const f = fixture();
    f.gateway.failFPS = 30;
    await f.service.updateDestinations("personal", ds());
    const status = await f.service.start("personal");
    expect(status.live).toBe(true);
    expect(status.groups.some((g) => g.status === "failed")).toBe(true);
    expect(JSON.stringify(status)).not.toContain("private-stream-key");
  });
  test("API restart discovers and stops every running profile without overrides", async () => {
    const f = fixture();
    await f.service.updateDestinations("personal", ds());
    await f.service.start("personal");
    const resumed = fixture(f.gateway);
    expect((await resumed.service.status("personal")).live).toBe(true);
    await resumed.service.stop("personal");
    expect(f.gateway.stops).toHaveLength(2);
    expect((await resumed.service.status("personal")).live).toBe(false);
  });
  test("destination settings preserve an omitted key and clear an explicit empty key", async () => {
    const f = fixture();
    await f.service.updateDestinations("personal", ds());
    const changed = ds().map(({ key: _key, ...d }) => ({ ...d, enabled: false }));
    await f.service.updateDestinations("personal", changed);
    expect(f.service.publicDestinations("personal")[0]!.hasKey).toBe(true);
    await f.service.updateDestinations(
      "personal",
      changed.map((d) => ({ ...d, key: "" })),
    );
    expect(f.service.publicDestinations("personal")[0]!.hasKey).toBe(false);
    expect(() => validateURL("file:///etc/passwd")).toThrow();
    expect(() => validateURL("rtmp://localhost/app")).toThrow();
  });
});
test.each([
  [false, "http://localhost:5173", 200],
  [false, "http://127.0.0.1:5173", 200],
  [false, "https://untrusted.example.com", 403],
  [false, "http://localhost:5173.untrusted.example.com", 403],
  [true, "http://localhost:5173", 403],
  [true, "http://127.0.0.1:5173", 403],
  [true, "https://studio.example.com", 200],
  [true, "https://untrusted.example.com", 403],
] as const)(
  "HTTP session origin enforcement (production=%s, origin=%s, status=%s)",
  async (production, origin, status) => {
    const { app } = createApp({ ...config, production }, new FakeGateway());
    const server = app.listen(0, "127.0.0.1");
    try {
      await new Promise<void>((resolve, reject) => {
        server.on("listening", resolve);
        server.on("error", reject);
      });
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("No test port");
      const response = await fetch(`http://127.0.0.1:${address.port}/api/session`, {
        method: "POST",
        headers: { Origin: origin, "Content-Type": "application/json" },
        body: JSON.stringify({ studio: "personal", name: "Host", passcode: config.passcode }),
      });
      expect(response.status).toBe(status);
      if (status === 200) expect(response.headers.get("set-cookie")).toContain("HttpOnly");
      else expect(await response.json()).toEqual({ error: "This request origin is not allowed." });
    } finally {
      server.close();
    }
  },
);
test("HTTP routes enforce host authorization and scoped media access", async () => {
  const root = await mkdtemp(join(tmpdir(), "studio-http-media-"));
  await mkdir(join(root, "logos"));
  await writeFile(join(root, "logos", "test.png"), "0123456789");
  const gateway = new FakeGateway(),
    { app } = createApp(
      { ...config, mediaRoot: root, publicUrl: "http://localhost:3001" },
      gateway,
    );
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.on("listening", resolve);
    server.on("error", reject);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No test port");
  const base = `http://127.0.0.1:${address.port}`;
  const auth = new Auth(config.secret);
  const token = auth.sign({
    role: "guest",
    studio: "personal",
    identity: "guest-1",
    name: "Guest",
    expires: Date.now() + 10000,
    purpose: "session",
  });
  try {
    const request = (path: string, method = "GET", body?: unknown, cookie?: string) =>
      fetch(`${base}${path}`, {
        method,
        headers: {
          "Content-Type": "application/json",
          ...(cookie ? { Cookie: `studio-session=${cookie}` } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    expect((await request("/api/studios/personal/state")).status).toBe(401);
    expect(
      (
        await request(
          "/api/studios/personal/commands",
          "POST",
          { type: "title", title: "No" },
          token,
        )
      ).status,
    ).toBe(403);
    expect((await request("/api/studios/personal/broadcast/start", "POST", {}, token)).status).toBe(
      403,
    );
    expect((await request("/api/studios/other/state", "GET", undefined, token)).status).toBe(401);
    expect((await request("/media/anything")).status).toBe(401);
    const login = await request("/api/session", "POST", {
      studio: "personal",
      name: "Host",
      passcode: config.passcode,
    });
    expect(login.status).toBe(200);
    expect(login.headers.get("set-cookie")).toContain("HttpOnly");
    const hostCookie = login.headers.get("set-cookie")!.split(";")[0]!.split("=")[1]!;
    const messagesPath = "/api/studios/personal/messages";
    expect((await request(messagesPath)).status).toBe(401);
    expect((await request("/api/studios/other/messages", "GET", undefined, token)).status).toBe(
      401,
    );
    expect((await request(messagesPath, "POST", { text: "Not connected" }, token)).status).toBe(
      400,
    );
    gateway.people = ["host", "guest-1"].map((identity) => ({
      identity,
      name: identity === "host" ? "Host" : "Alex",
      role: identity === "host" ? "host" : "guest",
      camera: false,
      microphone: false,
      screenSid: null,
    }));
    const hostMessage = await request(
      messagesPath,
      "POST",
      { text: "  Welcome backstage  " },
      hostCookie,
    );
    expect(hostMessage.status).toBe(200);
    const guestHistory = await (await request(messagesPath, "GET", undefined, token)).json();
    expect(guestHistory.messages[0].text).toBe("Welcome backstage");
    expect(guestHistory.messages[0].role).toBe("host");
    expect(
      (
        await request(
          messagesPath,
          "POST",
          { text: "Hello host!", identity: "host", role: "host", name: "Impersonated" },
          token,
        )
      ).status,
    ).toBe(200);
    const hostHistory = await (await request(messagesPath, "GET", undefined, hostCookie)).json();
    expect(hostHistory.messages[1]).toMatchObject({
      identity: "guest-1",
      role: "guest",
      name: "Alex",
      text: "Hello host!",
    });
    expect((await request(messagesPath, "POST", { text: "   " }, token)).status).toBe(400);
    expect((await request(messagesPath, "POST", { text: "x".repeat(2001) }, token)).status).toBe(
      400,
    );
    const renderToken = auth.sign({
      studio: "personal",
      identity: "renderer-test",
      name: "Renderer",
      role: "renderer",
      purpose: "render",
      expires: Date.now() + 10000,
    });
    expect(
      (await request(`${messagesPath}?access=${encodeURIComponent(renderToken)}`)).status,
    ).toBe(403);
    expect(
      (
        await request(`${messagesPath}?access=${encodeURIComponent(renderToken)}`, "POST", {
          text: "Renderer",
        })
      ).status,
    ).toBe(403);
    const renderState = await (
      await request(`/api/studios/personal/state?access=${encodeURIComponent(renderToken)}`)
    ).json();
    expect(JSON.stringify(renderState)).not.toContain("Welcome backstage");
    const manifest1 = await (
      await request("/api/studios/personal/assets", "GET", undefined, hostCookie)
    ).json();
    expect(manifest1.assets).toHaveLength(1);
    const manifest2 = await (
      await request("/api/studios/personal/assets", "GET", undefined, hostCookie)
    ).json();
    expect(manifest2.assets[0].url).toBe(manifest1.assets[0].url);
    const ranged = await fetch(`${base}${manifest1.assets[0].url}`, {
      headers: { Range: "bytes=0-3" },
    });
    expect(ranged.status).toBe(206);
    expect(ranged.headers.get("content-range")).toBe("bytes 0-3/10");
    expect(await ranged.text()).toBe("0123");
    const mediaToken = new URL(`${base}${manifest1.assets[0].url}`).searchParams.get("access")!;
    expect(
      (await request(`/api/studios/personal/state?access=${encodeURIComponent(mediaToken)}`))
        .status,
    ).toBe(401);
    expect(
      (
        await fetch(`${base}/api/studios/personal/commands`, {
          method: "POST",
          headers: {
            Origin: "https://untrusted.example.com",
            Cookie: `studio-session=${hostCookie}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ type: "title", title: "Changed" }),
        })
      ).status,
    ).toBe(403);
    const update = await request(
      "/api/studios/personal/commands",
      "POST",
      { type: "title", title: "My show" },
      hostCookie,
    );
    expect(update.status).toBe(200);
    expect(gateway.state.title).toBe("My show");
    const invite = auth.sign({
      role: "guest",
      studio: "personal",
      identity: "invite",
      name: "Guest",
      expires: Date.now() + 10000,
      purpose: "invite",
    });
    expect(
      (await request(`/api/studios/personal/state?access=${encodeURIComponent(invite)}`)).status,
    ).toBe(401);
    await mkdir(join(root, "backgrounds"));
    await writeFile(join(root, "backgrounds", "room.png"), "background-image");
    const previewBackgrounds = await request("/api/backgrounds");
    expect(previewBackgrounds.status).toBe(200);
    const previewManifest = await previewBackgrounds.json();
    expect(previewManifest.assets).toHaveLength(1);
    expect(previewManifest.assets[0].category).toBe("backgrounds");
    expect(previewManifest.assets[0].url).not.toContain("access=");
    expect(await (await request(previewManifest.assets[0].url)).text()).toBe("background-image");
    expect((await request("/api/session")).headers.get("set-cookie")).toBeNull();
    expect(await (await request("/api/session")).json()).toBeNull();
    expect((await request(`/api/backgrounds/${manifest1.assets[0].id}`)).status).toBe(404);
    expect((await request("/api/backgrounds/missing")).status).toBe(404);
    expect((await request(`/media/${previewManifest.assets[0].id}`)).status).toBe(401);
    await writeFile(join(root, "backgrounds", "second.webp"), "another-background");
    expect((await (await request("/api/backgrounds")).json()).assets).toHaveLength(2);
    await rm(join(root, "backgrounds", "second.webp"));
    expect((await request("/api/studios/personal/backgrounds")).status).toBe(401);
    const backgrounds = await request(
      `/api/studios/personal/backgrounds?access=${encodeURIComponent(invite)}`,
    );
    expect(backgrounds.status).toBe(200);
    const manifest = await backgrounds.json();
    expect(manifest.assets).toHaveLength(1);
    expect(manifest.assets[0].category).toBe("backgrounds");
    expect(await (await fetch(`${base}${manifest.assets[0].url}`)).text()).toBe("background-image");
    expect(
      (await request("/api/studios/personal/backgrounds", "GET", undefined, hostCookie)).status,
    ).toBe(200);
    expect(
      (await request(`/api/studios/other/backgrounds?access=${encodeURIComponent(invite)}`)).status,
    ).toBe(401);
    expect((await request("/api/studios/personal/backgrounds?access=invalid")).status).toBe(401);
    const expiredInvite = auth.sign({
      role: "guest",
      studio: "personal",
      identity: "invite",
      name: "Guest",
      expires: Date.now() - 1000,
      purpose: "invite",
    });
    expect(
      (
        await request(
          `/api/studios/personal/backgrounds?access=${encodeURIComponent(expiredInvite)}`,
        )
      ).status,
    ).toBe(401);
    expect(
      (await request(`/api/studios/personal/assets?access=${encodeURIComponent(invite)}`)).status,
    ).toBe(401);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(root, { recursive: true });
  }
});
