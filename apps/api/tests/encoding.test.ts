import { test, expect } from "bun:test";
import { AudioCodec, VideoCodec } from "livekit-server-sdk";
import { defaultEncoding, defaultPlatformEncoding } from "@studio/contracts";
import { createEncodingOptions, LiveKitGateway, verifyRenderer } from "../src/livekit";
import type { Config } from "../src/config";
test("the Egress adapter explicitly requests 1080p60, H264 Main and AAC", () => {
  const e = createEncodingOptions(defaultEncoding);
  expect(e.width).toBe(1920);
  expect(e.height).toBe(1080);
  expect(e.framerate).toBe(60);
  expect(e.videoCodec).toBe(VideoCodec.H264_MAIN);
  expect(e.audioCodec).toBe(AudioCodec.AAC);
  expect(e.videoBitrate).toBe(6000);
  expect(e.audioBitrate).toBe(128);
  expect(e.audioFrequency).toBe(48000);
  expect(e.keyFrameInterval).toBe(2);
});
test("X defaults to its own 1080p30 encoding and three-second keyframes", () => {
  const x = createEncodingOptions(defaultPlatformEncoding("x"));
  expect(x.framerate).toBe(30);
  expect(x.videoBitrate).toBe(9000);
  expect(x.keyFrameInterval).toBe(3);
  for (const platform of ["youtube", "twitch"] as const) {
    const e = createEncodingOptions(defaultPlatformEncoding(platform));
    expect(e.framerate).toBe(60);
    expect(e.keyFrameInterval).toBe(2);
  }
});
test("participant grants cannot change room metadata or publish control data", async () => {
  const gateway = new LiveKitGateway({
    livekitUrl: "wss://test.example.com",
    apiKey: "api-key",
    apiSecret: "api-secret",
  } as Config);
  const token = await gateway.token("studio-personal", "guest-1", "Guest", "guest");
  const payload = JSON.parse(Buffer.from(token.split(".")[1]!, "base64url").toString());
  expect(payload.video.room).toBe("studio-personal");
  expect(payload.video.canPublish).toBe(true);
  expect(payload.video.canPublishData).toBe(false);
  expect(payload.video.canUpdateOwnMetadata).toBe(false);
  expect(payload.exp - payload.nbf).toBeLessThanOrEqual(60);
});
test("renderer preflight rejects dead tunnels and an unauthenticated renderer API", async () => {
  const renderURL = "https://studio.example.com/broadcast/personal?access=scoped-render-access";
  const calls: string[] = [];
  const request = async (url: string | URL | Request) => {
    calls.push(String(url));
    return calls.length === 1
      ? new Response('<div id="root"></div><script src="/assets/app.js"></script>', {
          headers: { "Content-Type": "text/html" },
        })
      : Response.json({ assets: [] });
  };
  await verifyRenderer(renderURL, request);
  expect(calls).toEqual([
    renderURL,
    "https://studio.example.com/api/studios/personal/assets?access=scoped-render-access",
  ]);
  const deadTunnel = async () => new Response("Cloudflare origin DNS error", { status: 530 });
  await expect(verifyRenderer(renderURL, deadTunnel)).rejects.toThrow("PUBLIC_APP_URL");
  const unauthorized = async (url: string | URL | Request) =>
    String(url).includes("/api/")
      ? Response.json({ error: "Join this studio to continue." }, { status: 401 })
      : new Response('<div id="root"></div><script src="/assets/app.js"></script>', {
          headers: { "Content-Type": "text/html" },
        });
  await expect(verifyRenderer(renderURL, unauthorized)).rejects.toThrow("public program renderer");
});
