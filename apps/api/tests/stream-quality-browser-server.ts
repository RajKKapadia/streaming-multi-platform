import { resolve } from "node:path";
import { AccessToken, RoomServiceClient } from "livekit-server-sdk";
import { loadConfig } from "../src/config";

// Manual browser integration check: generated frames only, no Egress or devices.
const config = loadConfig();
const roomName = `studio-quality-check-${Date.now()}`;
const client = new RoomServiceClient(
  config.livekitUrl.replace(/^wss:/, "https:").replace(/^ws:/, "http:"),
  config.apiKey,
  config.apiSecret,
);
const built = await Bun.build({
  entrypoints: [resolve(import.meta.dir, "../../web/tests/stream-quality-browser.ts")],
  target: "browser",
  minify: true,
});
if (!built.success) throw new Error("Browser harness build failed.");
await client.createRoom({ name: roomName, emptyTimeout: 30, departureTimeout: 10 });
const token = async (identity: string, canPublish: boolean) => {
  const at = new AccessToken(config.apiKey, config.apiSecret, { identity, ttl: 300 });
  at.addGrant({
    room: roomName,
    roomJoin: true,
    canPublish,
    canSubscribe: true,
    canPublishData: false,
  });
  return at.toJwt();
};
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 4178,
  async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === "/credentials")
      return Response.json(
        {
          url: config.livekitUrl,
          oldToken: await token("quality-old", true),
          fixedToken: await token("quality-fixed", true),
          subscriberToken: await token("quality-subscriber", false),
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    if (path === "/test.js")
      return new Response(built.outputs[0], {
        headers: { "Content-Type": "text/javascript" },
      });
    return new Response(
      `<!doctype html><html><head><title>Camera quality verification</title>
      <style>body{font:18px system-ui;background:#101828;color:white;padding:32px}
      button{font-size:20px;padding:12px}canvas,video{width:440px;display:inline-block}
      pre{white-space:pre-wrap;line-height:1.6}</style></head><body>
      <h1>Camera quality verification</h1>
      <p>Uses generated shapes through an isolated LiveKit room. No camera or microphone permission is needed.</p>
      <button id="run">Run synthetic camera checks</button><pre id="results"></pre>
      <canvas id="source"></canvas><video id="received" autoplay muted playsinline></video>
      <script type="module" src="/test.js"></script></body></html>`,
      { headers: { "Content-Type": "text/html" } },
    );
  },
});
console.log("Synthetic camera test ready at http://127.0.0.1:4178");
async function shutdown() {
  await client.deleteRoom(roomName).catch(() => {});
  server.stop(true);
  process.exit();
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
setTimeout(shutdown, 10 * 60000);
