import express from "express";
import cookieParser from "cookie-parser";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import { commandSchema, destinationSchema, visualSchema } from "@studio/contracts";
import { configurationIssues, type Config } from "./config";
import { Auth, matchesPasscode, type Claims } from "./auth";
import { MediaLibrary } from "./media";
import { LiveKitGateway, type Gateway } from "./livekit";
import { StudioService } from "./service";
const studioSchema = z.string().regex(/^[a-z0-9-]{1,64}$/);
export function createApp(config: Config, gateway?: Gateway) {
  const app = express(),
    auth = new Auth(config.secret),
    media = new MediaLibrary(config.mediaRoot);
  const mediaAccess = new Map<string, { token: string; expires: number }>();
  const service = new StudioService(config, gateway ?? new LiveKitGateway(config), auth, media);
  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  app.use(express.json({ limit: "32kb" }), cookieParser());
  app.use((req, res, next) => {
    res.set("X-Content-Type-Options", "nosniff");
    if (req.path.startsWith("/api") || req.path.startsWith("/media"))
      res.set("Cache-Control", "no-store");
    if (req.method !== "GET" && req.headers.origin) {
      const origin = req.headers.origin;
      const allowed = new Set([
        new URL(config.publicUrl).origin,
        "http://localhost:5173",
        "http://127.0.0.1:5173",
      ]);
      if (!allowed.has(origin))
        return res.status(403).json({ error: "This request origin is not allowed." });
    }
    next();
  });
  app.get("/api/health", (_req, res) =>
    res.json({
      ready: configurationIssues(config).length === 0,
      issues: configurationIssues(config),
      serverTime: Date.now(),
    }),
  );
  const attempts = new Map<string, { count: number; reset: number }>();
  app.post("/api/session", async (req, res) => {
    const key = req.ip ?? "local",
      now = Date.now(),
      entry = attempts.get(key) ?? { count: 0, reset: now + 60_000 };
    if (entry.reset < now) {
      entry.count = 0;
      entry.reset = now + 60_000;
    }
    entry.count++;
    attempts.set(key, entry);
    if (attempts.size > 2000)
      for (const [ip, e] of attempts) if (e.reset < now) attempts.delete(ip);
    if (entry.count > 10)
      return res.status(429).json({ error: "Too many attempts. Wait one minute and try again." });
    const parsed = z
      .object({
        passcode: z.string().max(200),
        studio: studioSchema,
        name: z.string().trim().min(1).max(80),
      })
      .safeParse(req.body);
    if (!parsed.success)
      return res.status(400).json({ error: "Enter a display name and host passcode." });
    if (!matchesPasscode(config.passcode, parsed.data.passcode) || config.secret.length < 32)
      return res
        .status(401)
        .json({ error: "The host passcode is incorrect or the server is not configured." });
    const claims: Claims = {
      role: "host",
      studio: parsed.data.studio,
      identity: "host",
      name: parsed.data.name,
      expires: now + 12 * 3600_000,
      purpose: "session",
    };
    cookie(res, auth.sign(claims), config);
    res.json({ role: "host", studio: claims.studio });
  });
  app.delete("/api/session", (_req, res) => {
    res.clearCookie("studio-session", { path: "/" });
    res.json({ ok: true });
  });
  app.post("/api/guest-session", (req, res) => {
    const parsed = z
      .object({ invite: z.string(), name: z.string().trim().min(1).max(80) })
      .safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Enter your display name." });
    const invitation = auth.verify(parsed.data.invite, ["invite"]);
    if (!invitation || invitation.purpose !== "invite")
      return res
        .status(401)
        .json({ error: "This guest invitation has expired. Ask the host for a new link." });
    const current = auth.verify(req.cookies["studio-session"], ["session"]);
    const claims: Claims = {
      role: "guest",
      studio: invitation.studio,
      identity:
        current?.role === "guest" && current.studio === invitation.studio
          ? current.identity
          : `guest-${crypto.randomUUID()}`,
      name: parsed.data.name,
      expires: Math.min(invitation.expires, Date.now() + 12 * 3600_000),
      purpose: "session",
    };
    cookie(res, auth.sign(claims), config);
    res.json({ role: "guest", studio: claims.studio });
  });
  app.get("/api/session", (req, res) => {
    const c = auth.verify(req.cookies["studio-session"], ["session"]);
    res.json(c?.purpose === "session" ? { role: c.role, studio: c.studio, name: c.name } : null);
  });
  app.use("/api/studios/:studio", (req, res, next) => {
    const studio = studioSchema.safeParse(req.params.studio);
    if (!studio.success) return res.status(400).json({ error: "Invalid studio identifier." });
    const claims =
      auth.verify(req.cookies["studio-session"], ["session"]) ??
      auth.verify(req.query.access, ["render", "media"]);
    if (!claims || claims.studio !== studio.data || !["session", "render"].includes(claims.purpose))
      return res.status(401).json({ error: "Join this studio to continue." });
    res.locals.claims = claims;
    res.locals.studio = studio.data;
    if (!gateway && configurationIssues(config).length)
      return res
        .status(503)
        .json({ error: "Configure the server environment before connecting to LiveKit." });
    service.track(studio.data);
    next();
  });
  const host: express.RequestHandler = (_req, res, next) => {
    if (res.locals.claims.role !== "host")
      return res.status(403).json({ error: "Only the host can change studio controls." });
    next();
  };
  app.post("/api/studios/:studio/join", async (req, res) => {
    const c = res.locals.claims as Claims;
    const input = z
      .object({
        name: z.string().trim().min(1).max(80).optional(),
        visual: visualSchema.optional(),
      })
      .safeParse(req.body ?? {});
    if (!input.success) return res.status(400).json({ error: "Enter a valid display name." });
    if (input.data.name) {
      c.name = input.data.name;
      cookie(res, auth.sign(c), config);
    }
    if (c.role === "renderer")
      return res.status(403).json({ error: "Render access cannot join as a participant." });
    res.json(await service.join(c.studio, c.identity, c.name, c.role, input.data.visual));
  });
  app.post("/api/studios/:studio/invite", host, (_req, res) => {
    const studio = res.locals.studio as string;
    const invite = auth.sign({
      role: "guest",
      studio,
      identity: "invite",
      name: "Guest",
      purpose: "invite",
      expires: Date.now() + 12 * 3600_000,
    });
    res.json({
      url: `${config.publicUrl}/join/${studio}?invite=${encodeURIComponent(invite)}`,
      expires: Date.now() + 12 * 3600_000,
    });
  });
  app.get("/api/studios/:studio/state", async (_req, res) =>
    res.json(await service.sync(res.locals.studio)),
  );
  app.post("/api/studios/:studio/commands", host, async (req, res) => {
    const parsed = commandSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid studio command." });
    res.json(await service.command(res.locals.studio, parsed.data));
  });
  app.get("/api/studios/:studio/assets", async (_req, res) => {
    const studio = res.locals.studio as string;
    let entry = mediaAccess.get(studio);
    if (!entry || entry.expires < Date.now() + 3600_000) {
      const expires = Date.now() + 24 * 3600_000;
      entry = {
        token: auth.sign({
          studio,
          role: "renderer",
          identity: "media",
          name: "Media",
          purpose: "media",
          expires,
        }),
        expires,
      };
      mediaAccess.set(studio, entry);
    }
    const access = entry.token;
    res.json({
      assets: (await media.scan()).map((a) => ({
        ...a,
        url: `${a.url}?access=${encodeURIComponent(access)}&v=${a.version}`,
      })),
    });
  });
  app.get("/media/:id", async (req, res) => {
    const claims =
      auth.verify(req.cookies["studio-session"], ["session"]) ??
      auth.verify(req.query.access, ["render", "media"]);
    if (!claims || !["session", "media"].includes(claims.purpose)) return res.status(401).end();
    if (!media.asset(req.params.id)) await media.scan();
    const path = await media.path(req.params.id);
    if (!path) return res.status(404).end();
    res.sendFile(path, { acceptRanges: true, dotfiles: "deny" });
  });
  app.get("/api/studios/:studio/destinations", host, (_req, res) =>
    res.json(service.publicDestinations(res.locals.studio)),
  );
  app.put("/api/studios/:studio/destinations", host, async (req, res) => {
    const parsed = z.array(destinationSchema).length(3).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid destination settings." });
    res.json(await service.updateDestinations(res.locals.studio, parsed.data));
  });
  app.get("/api/studios/:studio/broadcast", host, async (_req, res) =>
    res.json(await service.status(res.locals.studio)),
  );
  app.post("/api/studios/:studio/broadcast/start", host, async (_req, res) =>
    res.json(await service.start(res.locals.studio)),
  );
  app.post("/api/studios/:studio/broadcast/stop", host, async (_req, res) =>
    res.json(await service.stop(res.locals.studio)),
  );
  if (existsSync(config.webRoot)) {
    app.use(express.static(config.webRoot));
    app.get("/{*path}", (req, res) =>
      req.path.startsWith("/api") || req.path.startsWith("/media")
        ? res.status(404).end()
        : res.sendFile(resolve(config.webRoot, "index.html")),
    );
  }
  app.use(
    (error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      // Never echo provider messages: they can contain RTMP keys or access tokens.
      const text = error instanceof Error ? error.message : "";
      const safe =
        /^(This |The stage |Add |Stop |Choose |Use a |Enter |Enable |Set PUBLIC_APP_URL|End the current|Some outputs|Provide |Invalid studio)/.test(
          text,
        )
          ? text
          : "The studio request failed. Check the server configuration and try again.";
      res.status(400).json({ error: safe });
    },
  );
  return { app, service };
}
function cookie(res: express.Response, value: string, config: Config) {
  res.cookie("studio-session", value, {
    httpOnly: true,
    sameSite: "lax",
    secure: config.publicUrl.startsWith("https://"),
    maxAge: 12 * 3600_000,
    path: "/",
  });
}
