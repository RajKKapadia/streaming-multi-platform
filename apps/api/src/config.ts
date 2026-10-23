import { resolve } from "node:path";
export type Config = {
  port: number;
  publicUrl: string;
  passcode: string;
  secret: string;
  livekitUrl: string;
  apiKey: string;
  apiSecret: string;
  mediaRoot: string;
  webRoot: string;
  production: boolean;
  recordingsRoot: string;
  egressRecordingsRoot: string;
  recordingsEnabled: boolean;
  recordingRendererUrl: string;
  ffmpegPath: string;
};
export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const root = resolve(import.meta.dir, "../../..");
  const file = resolve(root, ".env");
  if (existsSync(file))
    for (const [key, value] of Object.entries(parseEnv(readFileSync(file, "utf8"))))
      if (process.env[key] === undefined) process.env[key] = value;
  const localLivekit = /^wss?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(env.LIVEKIT_URL || "");
  return {
    port: Number(env.PORT || 3001),
    publicUrl: (env.PUBLIC_APP_URL || "http://localhost:3001").replace(/\/$/, ""),
    passcode: env.HOST_PASSCODE || "",
    secret: env.SESSION_SECRET || "",
    livekitUrl: env.LIVEKIT_URL || "",
    apiKey: env.LIVEKIT_API_KEY || "",
    apiSecret: env.LIVEKIT_API_SECRET || "",
    mediaRoot: resolve(env.MEDIA_ROOT || resolve(root, "media")),
    webRoot: resolve(root, "apps/web/dist"),
    production: env.NODE_ENV === "production",
    recordingsRoot: resolve(env.RECORDINGS_ROOT || resolve(root, ".local/recordings")),
    egressRecordingsRoot: env.EGRESS_RECORDINGS_ROOT || "/recordings",
    recordingsEnabled:
      env.RECORDINGS_ENABLED === "true" || (env.RECORDINGS_ENABLED !== "false" && localLivekit),
    recordingRendererUrl: (
      env.RECORDING_RENDERER_URL ||
      (localLivekit
        ? `http://127.0.0.1:${env.PORT || 3001}`
        : env.PUBLIC_APP_URL || "http://localhost:3001")
    ).replace(/\/$/, ""),
    ffmpegPath: env.FFMPEG_PATH || "ffmpeg",
  };
}
export function configurationIssues(c: Config): string[] {
  const issues: string[] = [];
  if (c.passcode.length < 8 || c.passcode.startsWith("replace-"))
    issues.push("Set HOST_PASSCODE to a private passcode of at least 8 characters.");
  if (c.secret.length < 32 || c.secret.startsWith("replace-"))
    issues.push("Set SESSION_SECRET to at least 32 random characters.");
  if (!c.livekitUrl || !c.apiKey || !c.apiSecret)
    issues.push("Add LIVEKIT_URL, LIVEKIT_API_KEY, and LIVEKIT_API_SECRET.");
  return issues;
}
import { existsSync, readFileSync } from "node:fs";
import { parseEnv } from "node:util";
