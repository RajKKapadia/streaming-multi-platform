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
  type StudioState,
  type ParticipantInfo,
  type Destination,
  type Role,
  type Encoding,
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
              width: 1920,
              height: 1080,
              framerate: encoding.fps,
              videoBitrate: encoding.bitrate,
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
describe("broadcast management", () => {
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
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(root, { recursive: true });
  }
});
