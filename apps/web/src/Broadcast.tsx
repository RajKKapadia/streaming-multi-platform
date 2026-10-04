import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { Room, RoomEvent } from "livekit-client";
// The SDK's CommonJS entry nests its default export in the production bundle.
import EgressHelper from "@livekit/egress-sdk/src/index";
import { ProgramCanvas, roomSources } from "@studio/rendering";
import { initialState, stateSchema, type Asset, type StudioState } from "@studio/contracts";
import { api, studioPath } from "./api";
import { useRoomUpdates } from "./devices";
async function prepare(asset: Asset) {
  await new Promise<void>((resolve, reject) => {
    if (asset.kind === "image") {
      const img = new Image();
      img.onload = () => resolve();
      img.onerror = () => reject(new Error(`Missing media: ${asset.name}`));
      img.src = asset.url;
      return;
    }
    const element = document.createElement(asset.kind === "video" ? "video" : "audio");
    const timer = setTimeout(
      () => reject(new Error(`Media readiness timed out: ${asset.name}`)),
      15000,
    );
    element.preload = "auto";
    element.onloadeddata = () => {
      clearTimeout(timer);
      resolve();
    };
    element.onerror = () => {
      clearTimeout(timer);
      reject(new Error(`Unsupported media: ${asset.name}`));
    };
    element.src = asset.url;
  });
}
export function Broadcast() {
  const { studioId = "personal" } = useParams(),
    [params] = useSearchParams(),
    access = params.get("access") ?? "",
    [room, setRoom] = useState<Room | null>(null),
    [state, setState] = useState<StudioState>(initialState()),
    [assets, setAssets] = useState<Asset[]>([]),
    [offset, setOffset] = useState(0),
    [error, setError] = useState("");
  useRoomUpdates(room);
  useEffect(() => {
    let disposed = false,
      instance: Room | null = null,
      timer: ReturnType<typeof setInterval> | undefined;
    const run = async () => {
      const requestStart = Date.now();
      const [snapshot, manifest] = await Promise.all([
        api<{ state: StudioState; serverTime: number }>(studioPath(studioId, "state", access)),
        api<{ assets: Asset[] }>(studioPath(studioId, "assets", access)),
      ]);
      if (disposed) return;
      setState(snapshot.state);
      setOffset(snapshot.serverTime - (requestStart + Date.now()) / 2);
      setAssets(manifest.assets);
      const active = new Set(
        [
          snapshot.state.logo.visible ? snapshot.state.logo.assetId : null,
          snapshot.state.overlay.visible ? snapshot.state.overlay.assetId : null,
          snapshot.state.background.kind === "image" ? snapshot.state.background.value : null,
          snapshot.state.clip?.assetId,
          snapshot.state.music?.assetId,
          snapshot.state.sound?.assetId,
        ].filter(Boolean),
      );
      if ([...active].some((id) => !manifest.assets.some((a) => a.id === id)))
        throw new Error("An active media file is missing.");
      await Promise.all(manifest.assets.filter((a) => active.has(a.id)).map(prepare));
      if (disposed) return;
      instance = new Room({ adaptiveStream: false, dynacast: false });
      instance.on(RoomEvent.RoomMetadataChanged, (metadata) => {
        try {
          const parsed = stateSchema.safeParse(JSON.parse(metadata || "{}"));
          if (parsed.success) {
            void api<{ assets: Asset[] }>(studioPath(studioId, "assets", access))
              .then((m) => {
                if (!disposed) {
                  setAssets(m.assets);
                  setState((s) => (parsed.data.revision >= s.revision ? parsed.data : s));
                }
              })
              .catch(() => setError("The active media could not be loaded."));
          }
        } catch {
          setError("The program state is invalid.");
        }
      });
      instance.on(RoomEvent.TrackSubscriptionFailed, () =>
        setError("A program track could not be subscribed."),
      );
      await instance.connect(EgressHelper.getLiveKitURL(), EgressHelper.getAccessToken(), {
        autoSubscribe: true,
      });
      if (disposed) {
        await instance.disconnect();
        return;
      }
      await instance.startAudio();
      setRoom(instance);
      // Studio state controls layout; the SDK still needs a recorder-layout callback.
      EgressHelper.onLayoutChanged(() => {});
      EgressHelper.setRoom(instance);
      // Wait for every existing track to subscribe and for React to paint before capture starts.
      const deadline = Date.now() + 15000;
      while (
        Date.now() < deadline &&
        [...instance.remoteParticipants.values()].some((p) =>
          [...p.trackPublications.values()].some((t) => !t.isMuted && !t.isSubscribed),
        )
      ) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      if (
        [...instance.remoteParticipants.values()].some((p) =>
          [...p.trackPublications.values()].some((t) => !t.isMuted && !t.isSubscribed),
        )
      )
        throw new Error("Program tracks did not become ready.");
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      if (!disposed) EgressHelper.startRecording();
      timer = setInterval(() => {
        void api<{ assets: Asset[] }>(studioPath(studioId, "assets", access))
          .then((m) => {
            if (!disposed) setAssets(m.assets);
          })
          .catch(() => setError("The media library is unavailable."));
      }, 10000);
    };
    void run().catch((e) => {
      if (!disposed) setError((e as Error).message);
    });
    return () => {
      disposed = true;
      if (timer) clearInterval(timer);
      void instance?.disconnect();
    };
  }, [studioId, access]);
  return (
    <div className="broadcast-page">
      {error ? (
        <div className="broadcast-error">{error}</div>
      ) : (
        <ProgramCanvas
          state={state}
          sources={room ? roomSources(room) : []}
          assets={assets}
          clockOffset={offset}
          programAudio
          effectsAudio
          onMediaError={setError}
        />
      )}
    </div>
  );
}
