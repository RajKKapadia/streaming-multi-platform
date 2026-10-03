import { test, expect } from "bun:test";
import { AudioCodec, VideoCodec } from "livekit-server-sdk";
import { defaultEncoding } from "@studio/contracts";
import { createEncodingOptions, LiveKitGateway } from "../src/livekit";
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
