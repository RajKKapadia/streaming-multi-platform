import { createHash } from "node:crypto";
import {
  applyCommand,
  initialState,
  settleState,
  stateSchema,
  defaultDestinationURLs,
  defaultPlatformEncoding,
  platformIds,
  messageHistoryLimit,
  messageInputSchema,
  type StudioState,
  type Command,
  type Destination,
  type PublicDestination,
  type BroadcastStatus,
  type Encoding,
  type Platform,
  type VisualPreset,
  type MessagesSnapshot,
} from "@studio/contracts";
import { EgressStatus, type EgressInfo } from "livekit-server-sdk";
import { activeEgress, RendererUnavailableError, type Gateway } from "./livekit";
import type { Config } from "./config";
import type { Auth } from "./auth";
import type { MediaLibrary } from "./media";

export class StudioService {
  private maintaining = false;
  private knownStudios = new Set<string>();
  private queues = new Map<string, Promise<unknown>>();
  private overrides = new Map<string, Destination[]>();
  private managed = new Map<string, EgressInfo[]>();
  private pending = new Map<
    string,
    { id: string; encoding: Encoding; platforms: Platform[]; error?: string }[]
  >();
  private conversations = new Map<string, MessagesSnapshot>();
  constructor(
    private config: Config,
    private gateway: Gateway,
    private auth: Auth,
    private media: MediaLibrary,
  ) {}
  room(studio: string) {
    return `studio-${studio}`;
  }
  track(studio: string) {
    this.knownStudios.add(studio);
  }
  async maintain() {
    if (this.maintaining) return;
    this.maintaining = true;
    try {
      await Promise.allSettled([...this.knownStudios].map((studio) => this.sync(studio)));
    } finally {
      this.maintaining = false;
    }
  }
  async serial<T>(studio: string, task: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(studio) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(task);
    this.queues.set(studio, next);
    try {
      return await next;
    } finally {
      if (this.queues.get(studio) === next) this.queues.delete(studio);
    }
  }
  async state(studio: string) {
    const raw = await this.gateway.ensureRoom(this.room(studio), initialState());
    return stateSchema.parse(raw);
  }
  async sync(studio: string) {
    return this.serial(studio, async () => {
      const old = await this.state(studio),
        people = await this.gateway.participants(this.room(studio));
      let next = settleState(old, Date.now());
      // Disconnecting guests lose their stage slot; they return backstage on reconnect.
      for (const id of next.participants)
        if (id !== "host" && !people.some((p) => p.identity === id))
          next = applyCommand(next, { type: "stage.remove", identity: id }, Date.now());
      if (
        next.screen &&
        !people.some(
          (p) => p.identity === next.screen!.identity && p.screenSid === next.screen!.sid,
        )
      )
        next = applyCommand(next, { type: "screen", screen: null }, Date.now());
      if (next !== old) await this.gateway.publishState(this.room(studio), next);
      return { state: next, participants: people, serverTime: Date.now() };
    });
  }
  async join(
    studio: string,
    identity: string,
    name: string,
    role: "host" | "guest",
    visual?: VisualPreset,
  ) {
    return this.serial(studio, async () => {
      let state = await this.state(studio);
      if (role === "host" && state.revision === 0 && visual) {
        await this.media.scan();
        const bg = visual.background;
        const validBackground =
          bg.kind === "color"
            ? /^#[\da-f]{6}$/i.test(bg.value)
            : bg.kind === "gradient"
              ? ["ocean", "midnight", "lavender", "mint", "sunset", "berry"].includes(bg.value)
              : this.media.asset(bg.value)?.category === "backgrounds";
        const logoValid =
            !!visual.logo.assetId && this.media.asset(visual.logo.assetId)?.category === "logos",
          overlayValid =
            !!visual.overlay.assetId &&
            this.media.asset(visual.overlay.assetId)?.category === "overlays";
        state = {
          ...state,
          revision: state.revision + 1,
          layout: ["solo", "split", "grid", "spotlight"].includes(visual.layout)
            ? visual.layout
            : "grid",
          background: validBackground ? bg : state.background,
          logo: {
            ...visual.logo,
            assetId: logoValid ? visual.logo.assetId : null,
            visible: logoValid && visual.logo.visible,
          },
          overlay: {
            ...visual.overlay,
            assetId: overlayValid ? visual.overlay.assetId : null,
            visible: overlayValid && visual.overlay.visible,
          },
        };
        await this.gateway.publishState(this.room(studio), state);
      }
      const people = await this.gateway.participants(this.room(studio));
      const reservations = new Map(state.admissions.map((a) => [a.identity, a.expires]));
      const now = Date.now();
      for (const [id, expiry] of reservations)
        if (expiry < now || people.some((p) => p.identity === id)) reservations.delete(id);
      const guests = new Set([
        ...people.filter((p) => p.role === "guest").map((p) => p.identity),
        ...reservations.keys(),
      ]);
      if (role === "guest" && !guests.has(identity) && guests.size >= 3)
        throw new Error("This studio already has three guests. Try again after someone leaves.");
      if (role === "guest") {
        reservations.set(identity, now + 65_000);
        state = {
          ...state,
          admissions: [...reservations].map(([identity, expires]) => ({ identity, expires })),
          revision: state.revision + 1,
        };
        await this.gateway.publishState(this.room(studio), state);
      }
      if (role === "host" && !state.participants.includes(identity)) {
        state = applyCommand(state, { type: "stage.add", identity }, now);
        await this.gateway.publishState(this.room(studio), state);
      }
      return {
        identity,
        name,
        role,
        token: await this.gateway.token(this.room(studio), identity, name, role),
        url: this.config.livekitUrl,
        state,
        serverTime: Date.now(),
      };
    });
  }
  async command(studio: string, command: Command) {
    return this.serial(studio, async () => {
      const people = await this.gateway.participants(this.room(studio));
      if (command.type === "stage.add" && !people.some((p) => p.identity === command.identity))
        throw new Error("This participant has disconnected.");
      if (
        command.type === "screen" &&
        command.screen &&
        !people.some(
          (p) => p.identity === command.screen!.identity && p.screenSid === command.screen!.sid,
        )
      )
        throw new Error("This screen share is no longer available.");
      if (
        ["logo", "overlay", "play"].includes(command.type) &&
        "assetId" in command &&
        command.assetId
      ) {
        const asset = this.media.asset(command.assetId);
        const category =
          command.type === "play"
            ? ({ clip: "clips", music: "music", sound: "sounds" } as const)[command.channel]
            : command.type === "logo"
              ? "logos"
              : "overlays";
        if (!asset || asset.category !== category || !(await this.media.path(asset.id)))
          throw new Error("This media file is no longer available. Refresh the library.");
      }
      if (command.type === "background") {
        if (
          command.background.kind === "image" &&
          this.media.asset(command.background.value)?.category !== "backgrounds"
        )
          throw new Error("Choose an image from the background library.");
        if (command.background.kind === "color" && !/^#[\da-f]{6}$/i.test(command.background.value))
          throw new Error("Use a six digit hex color.");
        if (
          command.background.kind === "gradient" &&
          !["ocean", "midnight", "lavender", "mint", "sunset", "berry"].includes(
            command.background.value,
          )
        )
          throw new Error("Choose a built-in gradient.");
      }
      const next = applyCommand(await this.state(studio), command, Date.now());
      await this.gateway.publishState(this.room(studio), next);
      return { state: next, serverTime: Date.now() };
    });
  }
  messages(studio: string): MessagesSnapshot {
    let conversation = this.conversations.get(studio);
    if (!conversation) {
      conversation = { sessionId: crypto.randomUUID(), revision: 0, messages: [] };
      this.conversations.set(studio, conversation);
    }
    return conversation;
  }
  async sendMessage(
    studio: string,
    sender: { identity: string; name: string; role: "host" | "guest" },
    text: string,
  ) {
    const input = messageInputSchema.parse({ text });
    return this.serial(studio, async () => {
      const people = await this.gateway.participants(this.room(studio));
      const participant = people.find(
        (p) => p.identity === sender.identity && p.role === sender.role,
      );
      if (!participant) throw new Error("This participant must reconnect before sending messages.");
      const previous = this.messages(studio);
      const next: MessagesSnapshot = {
        sessionId: previous.sessionId,
        revision: previous.revision + 1,
        messages: [
          ...previous.messages,
          {
            id: crypto.randomUUID(),
            identity: sender.identity,
            name: participant.name || sender.name,
            role: sender.role,
            text: input.text,
            sentAt: Date.now(),
          },
        ].slice(-messageHistoryLimit),
      };
      this.conversations.set(studio, next);
      return next;
    });
  }
  destinations(studio: string): Destination[] {
    return (
      this.overrides.get(studio) ??
      platformIds.map((platform) => ({
        platform,
        enabled: false,
        url:
          platform === "twitch"
            ? defaultDestinationURLs.twitch
            : process.env[`${platform.toUpperCase()}_RTMP_URL`]?.trim() ||
              defaultDestinationURLs[platform],
        key: process.env[`${platform.toUpperCase()}_STREAM_KEY`]?.trim() ?? "",
        encoding: defaultPlatformEncoding(platform),
      }))
    );
  }
  publicDestinations(studio: string): PublicDestination[] {
    return this.destinations(studio).map(({ key, ...d }) => ({ ...d, hasKey: !!key }));
  }
  async updateDestinations(studio: string, input: Destination[]) {
    return this.serial(studio, async () => {
      if ((await this.jobs(studio)).some(activeEgress))
        throw new Error("End the current stream before changing destinations.");
      if (input.length !== 3 || new Set(input.map((d) => d.platform)).size !== 3)
        throw new Error("Provide one entry per destination.");
      const previous = this.destinations(studio);
      const next = input.map((d) => ({
        ...d,
        url: d.url.trim() || defaultDestinationURLs[d.platform],
        key:
          d.key === undefined ? previous.find((p) => p.platform === d.platform)?.key : d.key.trim(),
        encoding: {
          ...d.encoding,
          keyframeInterval: d.platform === "x" ? (3 as const) : (2 as const),
        },
      }));
      for (const d of next) {
        if (d.url) validateURL(d.url);
        if (d.platform !== "x" && d.encoding.fps !== 60)
          throw new Error("Use a 60 fps profile for YouTube and Twitch.");
        if (d.enabled && !d.url) throw new Error(`Enter the server URL from X Live Studio.`);
        if (d.enabled && !d.key) throw new Error(`Enter a stream key for ${d.platform}.`);
      }
      this.overrides.set(studio, next);
      return this.publicDestinations(studio);
    });
  }
  async start(studio: string) {
    return this.serial(studio, async () => {
      if ((await this.jobs(studio)).some(activeEgress)) return this.status(studio);
      const enabled = this.destinations(studio).filter((d) => d.enabled);
      if (!enabled.length) throw new Error("Enable at least one destination first.");
      if (!this.config.publicUrl.startsWith("https://"))
        throw new Error(
          "Set PUBLIC_APP_URL to your public HTTPS application URL before going live.",
        );
      const groups = new Map<string, Destination[]>();
      for (const d of enabled) {
        validateURL(d.url);
        if (!d.key) throw new Error(`Enter a stream key for ${d.platform}.`);
        const key = JSON.stringify(d.encoding);
        groups.set(key, [...(groups.get(key) ?? []), d]);
      }
      const failures: { id: string; encoding: Encoding; platforms: Platform[]; error?: string }[] =
        [];
      for (const ds of groups.values()) {
        const capability = this.auth.sign({
          role: "renderer",
          studio,
          identity: "renderer",
          name: "Program renderer",
          expires: Date.now() + 24 * 3600_000,
          purpose: "render",
        });
        const url = `${this.config.publicUrl}/broadcast/${studio}?access=${encodeURIComponent(capability)}`;
        try {
          const job = await this.gateway.start(
            this.room(studio),
            url,
            ds.map(outputURL),
            ds[0]!.encoding,
          );
          this.managed.set(studio, [...(this.managed.get(studio) ?? []), job]);
          const snapshot = await this.state(studio);
          await this.gateway.publishState(this.room(studio), {
            ...snapshot,
            revision: snapshot.revision + 1,
            broadcasts: [
              ...snapshot.broadcasts,
              {
                id: job.egressId,
                outputs: ds.map((d) => ({
                  platform: d.platform,
                  fingerprint: fingerprint(outputURL(d)),
                })),
              },
            ].slice(-16),
          });
        } catch (error) {
          failures.push({
            id: `failed-${createHash("sha256").update(JSON.stringify(ds[0]!.encoding)).digest("hex").slice(0, 8)}`,
            encoding: ds[0]!.encoding,
            platforms: ds.map((d) => d.platform),
            ...(error instanceof RendererUnavailableError ? { error: error.message } : {}),
          });
        }
      }
      this.pending.set(studio, failures);
      return this.status(studio);
    });
  }
  async stop(studio: string) {
    return this.serial(studio, async () => {
      const jobs = (await this.jobs(studio)).filter(activeEgress);
      const results = await Promise.allSettled(jobs.map((e) => this.gateway.stop(e.egressId)));
      this.pending.delete(studio);
      if (results.some((r) => r.status === "rejected"))
        throw new Error(
          "Some outputs could not be stopped. Refresh status and try End stream again.",
        );
      return this.status(studio);
    });
  }
  private async jobs(studio: string) {
    const listed = await this.gateway.list(this.room(studio));
    const merged = new Map((this.managed.get(studio) ?? []).map((e) => [e.egressId, e]));
    for (const e of listed) merged.set(e.egressId, e);
    const jobs = [...merged.values()];
    this.managed.set(studio, jobs);
    return jobs;
  }
  async status(studio: string): Promise<BroadcastStatus> {
    const jobs = await this.jobs(studio);
    const snapshot = stateSchema.safeParse(await this.gateway.readState(this.room(studio)));
    const groups = jobs.slice(-12).map((job) => {
      const record = snapshot.success
        ? snapshot.data.broadcasts.find((b) => b.id === job.egressId)
        : undefined;
      const encoding = readEncoding(job);
      const failed = [EgressStatus.EGRESS_FAILED, EgressStatus.EGRESS_ABORTED].includes(job.status);
      const outputs = job.streamResults.length
        ? job.streamResults
        : requestURLs(job).map((url) => ({
            url,
            status: failed
              ? 2
              : [EgressStatus.EGRESS_COMPLETE, EgressStatus.EGRESS_LIMIT_REACHED].includes(
                    job.status,
                  )
                ? 1
                : 0,
            error: job.error,
          }));
      return {
        id: job.egressId,
        status: EgressStatus[job.status]?.replace("EGRESS_", "").toLowerCase() ?? "unknown",
        encoding,
        destinations: outputs.map((o) => ({
          platform:
            record?.outputs.find((d) => d.fingerprint === fingerprint(o.url))?.platform ??
            identifyPlatform(o.url, this.destinations(studio)),
          status: failed
            ? "failed"
            : job.status === EgressStatus.EGRESS_STARTING && o.status === 0
              ? "starting"
              : (["active", "finished", "failed"][o.status] ?? "unknown"),
          ...(o.error || failed
            ? {
                error:
                  job.error === "Start signal not received"
                    ? "The program renderer did not become ready. Check that PUBLIC_APP_URL serves the latest build and its broadcast page and media are reachable."
                    : "The output failed. Check the program renderer, platform dashboard, and stream key.",
              }
            : {}),
        })),
      };
    });
    for (const failed of this.pending.get(studio) ?? [])
      groups.push({
        id: failed.id,
        status: "failed",
        encoding: failed.encoding,
        destinations: failed.platforms.map((platform) => ({
          platform,
          status: "failed",
          error:
            failed.error ??
            "This output could not start. Check LiveKit Egress access and platform settings.",
        })),
      });
    return { groups, live: jobs.some(activeEgress), serverTime: Date.now() };
  }
}
export function validateURL(value: string) {
  const u = new URL(value);
  if (
    !["rtmp:", "rtmps:"].includes(u.protocol) ||
    u.username ||
    u.password ||
    u.search ||
    u.hash ||
    !u.hostname ||
    /^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|::|\[)/i.test(u.hostname) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(u.hostname)
  )
    throw new Error(
      "Use a public RTMP or RTMPS server URL without credentials or query parameters.",
    );
}
function outputURL(d: Destination) {
  return `${d.url.replace(/\/$/, "")}/${d.key}`;
}
function identifyPlatform(url: string, ds: Destination[]): Platform {
  const match = ds.find((d) => d.key && outputURL(d) === url);
  if (match) return match.platform;
  const hostname = (() => {
    try {
      return new URL(url).hostname;
    } catch {
      return "";
    }
  })();
  return hostname.includes("youtube") ? "youtube" : hostname.includes("twitch") ? "twitch" : "x";
}
function readEncoding(job: EgressInfo): Encoding {
  const request = job.request;
  const encoding =
    request.case === "egress"
      ? request.value.encoding
      : request.case === "roomComposite"
        ? request.value.options
        : undefined;
  const options = encoding?.case === "advanced" ? encoding.value : null;
  return {
    width: 1920,
    height: 1080,
    fps: options?.framerate === 30 ? 30 : 60,
    bitrate: options?.videoBitrate ?? 6000,
    keyframeInterval: options?.keyFrameInterval === 3 ? 3 : 2,
  };
}

function requestURLs(job: EgressInfo): string[] {
  const r = job.request;
  if (r.case === "egress")
    return r.value.outputs.flatMap((o) => (o.config.case === "stream" ? o.config.value.urls : []));
  if (r.case === "roomComposite") return r.value.streamOutputs.flatMap((o) => o.urls);
  return [];
}

function fingerprint(url: string) {
  return createHash("sha256").update(url).digest("hex");
}
