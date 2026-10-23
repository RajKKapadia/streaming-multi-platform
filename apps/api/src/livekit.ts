import {
  AccessToken,
  RoomServiceClient,
  EgressClient,
  StartEgressRequest,
  TemplateSource,
  Output,
  StreamOutput,
  StreamProtocol,
  SegmentedFileOutput,
  SegmentedFileProtocol,
  EncodingOptions,
  AudioCodec,
  VideoCodec,
  TrackSource,
  EgressStatus,
  type EgressInfo,
} from "livekit-server-sdk";
import type { Encoding, ParticipantInfo, Role, StudioState } from "@studio/contracts";
import type { Config } from "./config";
export interface Gateway {
  ensureRoom(name: string, state: StudioState): Promise<StudioState>;
  readState(name: string): Promise<StudioState | null>;
  publishState(name: string, state: StudioState): Promise<void>;
  participants(name: string): Promise<ParticipantInfo[]>;
  token(name: string, identity: string, displayName: string, role: Role): Promise<string>;
  start(name: string, renderUrl: string, urls: string[], encoding: Encoding): Promise<EgressInfo>;
  startRecording(
    name: string,
    renderUrl: string,
    directory: string,
    encoding: Encoding,
  ): Promise<EgressInfo>;
  list(name: string): Promise<EgressInfo[]>;
  stop(id: string): Promise<void>;
}
export class LiveKitGateway implements Gateway {
  private rooms: RoomServiceClient;
  private egress: EgressClient;
  constructor(private config: Config) {
    const url = config.livekitUrl.replace(/^wss:/, "https:").replace(/^ws:/, "http:");
    this.rooms = new RoomServiceClient(url, config.apiKey, config.apiSecret);
    this.egress = new EgressClient(url, config.apiKey, config.apiSecret);
  }
  async readState(name: string) {
    const room = (await this.rooms.listRooms([name]))[0];
    if (!room?.metadata) return null;
    try {
      return JSON.parse(room.metadata) as StudioState;
    } catch {
      return null;
    }
  }
  async ensureRoom(name: string, state: StudioState) {
    const existing = await this.readState(name);
    if (existing) return existing;
    await this.rooms.createRoom({
      name,
      emptyTimeout: 3600,
      departureTimeout: 60,
      metadata: JSON.stringify(state),
    });
    return state;
  }
  async publishState(name: string, state: StudioState) {
    await this.rooms.updateRoomMetadata(name, JSON.stringify(state));
  }
  async participants(name: string): Promise<ParticipantInfo[]> {
    return (await this.rooms.listParticipants(name))
      .filter((p) => p.identity === "host" || p.identity.startsWith("guest-"))
      .map((p) => ({
        identity: p.identity,
        name: p.name || p.identity,
        role: p.identity === "host" ? "host" : "guest",
        camera: p.tracks.some((t) => t.source === TrackSource.CAMERA && !t.muted),
        microphone: p.tracks.some((t) => t.source === TrackSource.MICROPHONE && !t.muted),
        screenSid:
          p.tracks.find((t) => t.source === TrackSource.SCREEN_SHARE && !t.muted)?.sid ?? null,
      }));
  }
  async token(name: string, identity: string, displayName: string, role: Role) {
    const at = new AccessToken(this.config.apiKey, this.config.apiSecret, {
      identity,
      name: displayName,
      ttl: role === "guest" ? 60 : 3600,
      metadata: JSON.stringify({ role }),
    });
    at.addGrant({
      roomJoin: true,
      room: name,
      canPublish: role !== "renderer",
      canSubscribe: true,
      canPublishData: false,
      canUpdateOwnMetadata: false,
    });
    return at.toJwt();
  }
  async start(name: string, renderUrl: string, urls: string[], e: Encoding) {
    await verifyRenderer(renderUrl);
    const encodingOptions = createEncodingOptions(e);
    if (typeof this.egress.startEgress === "function")
      return this.egress.startEgress(
        new StartEgressRequest({
          roomName: name,
          source: { case: "template", value: new TemplateSource({ customBaseUrl: renderUrl }) },
          encoding: { case: "advanced", value: encodingOptions },
          outputs: [
            new Output({
              config: {
                case: "stream",
                value: new StreamOutput({ protocol: StreamProtocol.RTMP, urls }),
              },
            }),
          ],
        }),
      );
    return this.egress.startRoomCompositeEgress(
      name,
      new StreamOutput({ protocol: StreamProtocol.RTMP, urls }),
      { customBaseUrl: renderUrl, encodingOptions },
    );
  }
  async list(name: string) {
    return this.egress.listEgress({ roomName: name });
  }
  async startRecording(name: string, renderUrl: string, directory: string, encoding: Encoding) {
    await verifyRenderer(renderUrl);
    return this.egress.startEgress(createRecordingRequest(name, renderUrl, directory, encoding));
  }
  async stop(id: string) {
    await this.egress.stopEgress(id);
  }
}
export function createRecordingRequest(
  name: string,
  renderUrl: string,
  directory: string,
  encoding: Encoding,
) {
  return new StartEgressRequest({
    roomName: name,
    source: { case: "template", value: new TemplateSource({ customBaseUrl: renderUrl }) },
    encoding: { case: "advanced", value: createEncodingOptions(encoding) },
    outputs: [
      new Output({
        config: {
          case: "segments",
          value: new SegmentedFileOutput({
            protocol: SegmentedFileProtocol.HLS_PROTOCOL,
            filenamePrefix: `${directory}/segment`,
            playlistName: `${directory}/recording.m3u8`,
            segmentDuration: 2,
            disableManifest: true,
          }),
        },
      }),
    ],
  });
}

export function streamEgress(job: EgressInfo) {
  const request = job.request;
  if (request.case === "egress")
    return request.value.outputs.some((o) => o.config.case === "stream");
  if (request.case === "roomComposite") return request.value.streamOutputs.length > 0;
  return job.streamResults.length > 0 || job.result.case === "stream";
}
export class RendererUnavailableError extends Error {
  constructor() {
    super(
      "The public program renderer is unreachable. Check PUBLIC_APP_URL, keep its HTTPS tunnel running, rebuild the app, and restart the API after changing the tunnel URL.",
    );
  }
}
export async function verifyRenderer(
  renderUrl: string,
  request: (input: string | URL, init?: RequestInit) => Promise<Response> = fetch,
) {
  try {
    const url = new URL(renderUrl);
    const studio = url.pathname.split("/").pop();
    const manifestURL = new URL(`/api/studios/${studio}/assets`, url);
    manifestURL.searchParams.set("access", url.searchParams.get("access") ?? "");
    const response = await request(renderUrl, { signal: AbortSignal.timeout(10000) });
    if (!response.ok || !response.headers.get("content-type")?.includes("text/html"))
      throw new RendererUnavailableError();
    const page = await response.text();
    if (!page.includes('id="root"') || !page.includes("/assets/"))
      throw new RendererUnavailableError();
    const manifest = await request(manifestURL, { signal: AbortSignal.timeout(10000) });
    if (!manifest.ok || !Array.isArray((await manifest.json()).assets))
      throw new RendererUnavailableError();
  } catch {
    throw new RendererUnavailableError();
  }
}
export function activeEgress(e: EgressInfo) {
  return [
    EgressStatus.EGRESS_STARTING,
    EgressStatus.EGRESS_ACTIVE,
    EgressStatus.EGRESS_ENDING,
  ].includes(e.status);
}

export function createEncodingOptions(e: Encoding) {
  return new EncodingOptions({
    width: e.width,
    height: e.height,
    framerate: e.fps,
    videoCodec: VideoCodec.H264_MAIN,
    videoBitrate: e.bitrate,
    audioCodec: AudioCodec.AAC,
    audioBitrate: 128,
    audioFrequency: 48000,
    keyFrameInterval: e.keyframeInterval ?? 2,
  });
}
