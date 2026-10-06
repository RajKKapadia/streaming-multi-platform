import { z } from "zod";

export const layoutIds = [
  "solo",
  "split",
  "grid",
  "spotlight",
  "screen-presenter",
  "screen-rail",
  "pip",
  "screen-only",
] as const;
export type LayoutId = (typeof layoutIds)[number];
export const layouts: { id: LayoutId; name: string; screen: boolean }[] = [
  { id: "solo", name: "Solo", screen: false },
  { id: "split", name: "Split", screen: false },
  { id: "grid", name: "Inset grid", screen: false },
  { id: "spotlight", name: "Spotlight", screen: false },
  { id: "screen-presenter", name: "Screen + presenter", screen: true },
  { id: "screen-rail", name: "Screen + cameras", screen: true },
  { id: "pip", name: "Picture in picture", screen: true },
  { id: "screen-only", name: "Screen only", screen: true },
];
export const categories = ["logos", "overlays", "clips", "backgrounds", "music", "sounds"] as const;
export type AssetCategory = (typeof categories)[number];
export type Asset = {
  id: string;
  category: AssetCategory;
  name: string;
  filename: string;
  url: string;
  kind: "image" | "video" | "audio";
  version: string;
};
const playbackSchema = z.object({
  id: z.string(),
  assetId: z.string(),
  startedAt: z.number(),
  position: z.number().nonnegative(),
  duration: z.number().positive(),
  loop: z.boolean(),
  volume: z.number().min(0).max(1),
  playing: z.boolean(),
});
export type Playback = z.infer<typeof playbackSchema>;
export const backgroundSchema = z.object({
  kind: z.enum(["color", "gradient", "image"]),
  value: z.string().max(500),
});
export const stateSchema = z.object({
  broadcasts: z
    .array(
      z.object({
        id: z.string(),
        outputs: z.array(
          z.object({ fingerprint: z.string(), platform: z.enum(["youtube", "twitch", "x"]) }),
        ),
      }),
    )
    .max(16)
    .default([]),
  version: z.literal(1),
  revision: z.number().int().nonnegative(),
  title: z.string().max(100),
  admissions: z
    .array(z.object({ identity: z.string(), expires: z.number() }))
    .max(3)
    .default([]),
  participants: z.array(z.string()).max(4),
  featured: z.string().nullable(),
  layout: z.enum(layoutIds),
  screen: z.object({ identity: z.string(), sid: z.string() }).nullable(),
  background: backgroundSchema,
  logo: z.object({
    assetId: z.string().nullable(),
    visible: z.boolean(),
    placement: z.enum(["left", "right"]),
  }),
  overlay: z.object({ assetId: z.string().nullable(), visible: z.boolean(), fade: z.boolean() }),
  clip: playbackSchema.nullable(),
  music: playbackSchema.nullable(),
  sound: playbackSchema.nullable(),
  resumeMusicAfterClip: z.boolean(),
});
export type StudioState = z.infer<typeof stateSchema>;
export const visualSchema = stateSchema.pick({
  layout: true,
  background: true,
  logo: true,
  overlay: true,
});
export type VisualPreset = z.infer<typeof visualSchema>;
export function initialState(): StudioState {
  return {
    broadcasts: [],
    version: 1,
    revision: 0,
    title: "My broadcast",
    admissions: [],
    participants: [],
    featured: null,
    layout: "solo",
    screen: null,
    background: { kind: "gradient", value: "ocean" },
    logo: { assetId: null, visible: false, placement: "right" },
    overlay: { assetId: null, visible: false, fade: true },
    clip: null,
    music: null,
    sound: null,
    resumeMusicAfterClip: false,
  };
}
export const commandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("title"), title: z.string().trim().min(1).max(100) }),
  z.object({ type: z.literal("stage.add"), identity: z.string().min(1) }),
  z.object({ type: z.literal("stage.remove"), identity: z.string().min(1) }),
  z.object({ type: z.literal("feature"), identity: z.string().min(1) }),
  z.object({ type: z.literal("layout"), layout: z.enum(layoutIds) }),
  z.object({
    type: z.literal("screen"),
    screen: z.object({ identity: z.string(), sid: z.string() }).nullable(),
  }),
  z.object({ type: z.literal("background"), background: backgroundSchema }),
  z.object({
    type: z.literal("logo"),
    assetId: z.string().nullable(),
    visible: z.boolean(),
    placement: z.enum(["left", "right"]),
  }),
  z.object({
    type: z.literal("overlay"),
    assetId: z.string().nullable(),
    visible: z.boolean(),
    fade: z.boolean(),
  }),
  z.object({
    type: z.literal("play"),
    channel: z.enum(["clip", "music", "sound"]),
    assetId: z.string(),
    duration: z.number().finite().positive().max(86400),
    loop: z.boolean(),
    volume: z.number().min(0).max(1),
  }),
  z.object({
    type: z.literal("playback"),
    channel: z.enum(["clip", "music", "sound"]),
    action: z.enum(["pause", "resume", "stop"]),
  }),
  z.object({
    type: z.literal("volume"),
    channel: z.enum(["clip", "music", "sound"]),
    volume: z.number().min(0).max(1),
  }),
  z.object({
    type: z.literal("loop"),
    channel: z.enum(["clip", "music", "sound"]),
    loop: z.boolean(),
  }),
]);
export type Command = z.infer<typeof commandSchema>;
export function playbackPosition(p: Playback, now: number): number {
  const elapsed = p.position + (p.playing ? Math.max(0, now - p.startedAt) / 1000 : 0);
  return p.loop ? elapsed % p.duration : Math.min(elapsed, p.duration);
}
function restoreClip(s: StudioState, now: number) {
  s.clip = null;
  if (s.resumeMusicAfterClip && s.music) s.music = { ...s.music, playing: true, startedAt: now };
  s.resumeMusicAfterClip = false;
}
export function settleState(state: StudioState, now: number): StudioState {
  let s = state;
  let changed = false;
  for (const channel of ["clip", "music", "sound"] as const) {
    const p = s[channel];
    if (p?.playing && !p.loop && playbackPosition(p, now) >= p.duration) {
      if (!changed) s = structuredClone(state);
      if (channel === "clip") restoreClip(s, p.startedAt + (p.duration - p.position) * 1000);
      else s[channel] = null;
      changed = true;
    }
  }
  if (changed) s.revision++;
  return changed ? s : state;
}
export function nextPlaybackEnd(state: StudioState): number | null {
  const ends = [state.clip, state.music, state.sound]
    .filter((p): p is Playback => !!p?.playing && !p.loop)
    .map((p) => p.startedAt + Math.max(0, p.duration - p.position) * 1000);
  return ends.length ? Math.min(...ends) : null;
}
export function applyCommand(state: StudioState, command: Command, now: number): StudioState {
  const s = structuredClone(settleState(state, now));
  switch (command.type) {
    case "title":
      s.title = command.title;
      break;
    case "stage.add":
      if (!s.participants.includes(command.identity)) {
        if (s.participants.length >= 4) throw new Error("The stage supports four people.");
        s.participants.push(command.identity);
      }
      s.featured ??= command.identity;
      break;
    case "stage.remove":
      s.participants = s.participants.filter((id) => id !== command.identity);
      if (s.featured === command.identity) s.featured = s.participants[0] ?? null;
      break;
    case "feature":
      if (!s.participants.includes(command.identity))
        throw new Error("Add this participant to the stage first.");
      s.featured = command.identity;
      break;
    case "layout":
      if (layouts.find((l) => l.id === command.layout)?.screen && !s.screen)
        throw new Error("Add a screen share first.");
      s.layout = command.layout;
      break;
    case "screen":
      s.screen = command.screen;
      if (s.screen && !layouts.find((l) => l.id === s.layout)?.screen)
        s.layout = "screen-presenter";
      if (!s.screen && (s.layout.startsWith("screen") || s.layout === "pip")) s.layout = "grid";
      break;
    case "background":
      s.background = command.background;
      break;
    case "logo":
      s.logo = { assetId: command.assetId, visible: command.visible, placement: command.placement };
      break;
    case "overlay":
      s.overlay = { assetId: command.assetId, visible: command.visible, fade: command.fade };
      break;
    case "play": {
      if (s.clip && command.channel !== "clip")
        throw new Error("Stop the video clip before playing music or sounds.");
      if (command.channel === "clip") {
        if (!s.clip) s.resumeMusicAfterClip = !!s.music?.playing;
        if (s.music?.playing)
          s.music = {
            ...s.music,
            position: playbackPosition(s.music, now),
            playing: false,
            startedAt: now,
          };
        s.sound = null;
      }
      s[command.channel] = {
        id: crypto.randomUUID(),
        assetId: command.assetId,
        startedAt: now,
        position: 0,
        duration: command.duration,
        loop: command.loop,
        volume: command.volume,
        playing: true,
      };
      break;
    }
    case "playback": {
      if (s.clip && command.channel !== "clip" && command.action === "resume")
        throw new Error("Stop the video clip before resuming music or sounds.");
      const p = s[command.channel];
      if (!p) break;
      if (command.action === "stop") {
        if (command.channel === "clip") restoreClip(s, now);
        else s[command.channel] = null;
      } else
        s[command.channel] = {
          ...p,
          position: playbackPosition(p, now),
          playing: command.action === "resume",
          startedAt: now,
        };
      break;
    }
    case "loop": {
      const p = s[command.channel];
      if (p)
        s[command.channel] = {
          ...p,
          position: playbackPosition(p, now),
          startedAt: now,
          loop: command.loop,
        };
      break;
    }
    case "volume":
      if (s[command.channel])
        s[command.channel] = { ...s[command.channel]!, volume: command.volume };
      break;
  }
  s.revision++;
  return s;
}
export type Role = "host" | "guest" | "renderer";
export type ParticipantInfo = {
  identity: string;
  name: string;
  role: Role;
  camera: boolean;
  microphone: boolean;
  screenSid: string | null;
};
export const messageLimit = 2000;
export const messageHistoryLimit = 100;
export const messageInputSchema = z.object({
  text: z.string().trim().min(1).max(messageLimit),
});
export type StudioMessage = {
  id: string;
  identity: string;
  name: string;
  role: "host" | "guest";
  text: string;
  sentAt: number;
};
export type MessagesSnapshot = {
  sessionId: string;
  revision: number;
  messages: StudioMessage[];
};
export type JoinResponse = {
  identity: string;
  name: string;
  role: Role;
  token: string;
  url: string;
  state: StudioState;
  serverTime: number;
};
export const encodingSchema = z
  .object({
    width: z.union([z.literal(1280), z.literal(1920)]),
    height: z.union([z.literal(720), z.literal(1080)]),
    fps: z.union([z.literal(30), z.literal(60)]),
    bitrate: z.number().int().min(2500).max(20000),
    keyframeInterval: z.union([z.literal(2), z.literal(3)]).optional(),
  })
  .refine(
    (e) => (e.width === 1280 && e.height === 720) || (e.width === 1920 && e.height === 1080),
    {
      message: "Choose a 1280 × 720 or 1920 × 1080 output profile.",
    },
  );
export type Encoding = z.infer<typeof encodingSchema>;
export const defaultEncoding: Encoding = { width: 1920, height: 1080, fps: 60, bitrate: 6000 };
export const platformIds = ["youtube", "twitch", "x"] as const;
export type Platform = (typeof platformIds)[number];
export const defaultDestinationURLs: Record<Platform, string> = {
  youtube: "rtmps://a.rtmps.youtube.com:443/live2",
  twitch: "rtmp://live.twitch.tv/app",
  x: "",
};
export function defaultPlatformEncoding(platform: Platform): Encoding {
  return platform === "x"
    ? { width: 1280, height: 720, fps: 60, bitrate: 9000, keyframeInterval: 3 }
    : { ...defaultEncoding, keyframeInterval: 2 };
}
export const destinationSchema = z.object({
  platform: z.enum(platformIds),
  enabled: z.boolean(),
  url: z.string().max(1000),
  key: z.string().max(1000).optional(),
  encoding: encodingSchema,
});
export type Destination = z.infer<typeof destinationSchema>;
export type PublicDestination = Omit<Destination, "key"> & { hasKey: boolean };
export type BroadcastStatus = {
  groups: {
    id: string;
    status: string;
    encoding: Encoding;
    destinations: { platform: Platform; status: string; error?: string }[];
  }[];
  live: boolean;
  serverTime: number;
};
