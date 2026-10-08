import { useEffect, useState } from "react";
import type { LocalVideoTrack, TrackPublishDefaults } from "livekit-client";

export const studioPublishDefaults: TrackPublishDefaults = {
  videoCodec: "vp8",
  videoEncoding: { maxBitrate: 6000000, maxFramerate: 60 },
  screenShareEncoding: { maxBitrate: 6000000, maxFramerate: 60 },
  simulcast: true,
  // The SDK otherwise downsizes cameras to preserve frame rate under load. Once
  // that detail is lost, the full-resolution program encoder cannot recover it.
  degradationPreference: "maintain-resolution",
};

export function usePublishedVideo(camera: LocalVideoTrack | undefined, enabled: boolean) {
  const [published, setPublished] = useState<RTCOutboundRtpStreamStats | null>(null);
  useEffect(() => {
    setPublished(null);
    if (!enabled || !camera) return;
    let disposed = false;
    const update = async () => {
      try {
        const stats = await camera.getRTCStatsReport();
        let highest: RTCOutboundRtpStreamStats | null = null;
        stats?.forEach((sample: RTCOutboundRtpStreamStats) => {
          if (
            sample.type === "outbound-rtp" &&
            sample.kind === "video" &&
            sample.active !== false &&
            (sample.framesPerSecond ?? 0) > 0 &&
            (sample.frameHeight ?? 0) > (highest?.frameHeight ?? 0)
          )
            highest = sample;
        });
        if (!disposed) setPublished(highest);
      } catch {
        if (!disposed) setPublished(null);
      }
    };
    void update();
    const timer = setInterval(() => void update(), 2000);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, [camera, enabled]);
  return published;
}
