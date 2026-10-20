import { useEffect, useRef, useState } from "react";
import type { Track } from "livekit-client";
import { createForegroundRenderer } from "./foreground";

export function ForegroundVideo({ track }: { track: Track }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState("Removing background…");
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    // A model can finish loading after the selected camera changes. Give each effect its
    // own canvas so its late initialization or cleanup cannot touch the replacement.
    const canvas = document.createElement("canvas");
    container.append(canvas);
    const video = document.createElement("video");
    video.muted = true;
    video.autoplay = true;
    video.playsInline = true;
    track.attach(video);
    let disposed = false,
      ready = false,
      animation = 0,
      previousTime = -1,
      previousFrame = -Infinity;
    let renderer: Awaited<ReturnType<typeof createForegroundRenderer>> | undefined;
    setStatus("Removing background…");
    const fail = (error: unknown) => {
      if (disposed) return;
      canvas.width = canvas.width;
      setStatus(error instanceof Error ? error.message : "Presenter background removal failed.");
      renderer?.close();
      renderer = undefined;
    };
    const draw = (now: number) => {
      if (disposed) return;
      try {
        if (
          renderer &&
          video.readyState >= 2 &&
          video.videoWidth &&
          video.currentTime !== previousTime &&
          now - previousFrame >= 1000 / 30
        ) {
          renderer.render(video, now);
          previousTime = video.currentTime;
          previousFrame = now;
          if (!ready) {
            ready = true;
            setStatus("");
          }
        }
        animation = requestAnimationFrame(draw);
      } catch (error) {
        fail(error);
      }
    };
    void (async () => {
      await video.play();
      const created = await createForegroundRenderer(canvas);
      if (disposed) {
        created.close();
        return;
      }
      renderer = created;
      animation = requestAnimationFrame(draw);
    })().catch(fail);
    return () => {
      disposed = true;
      cancelAnimationFrame(animation);
      renderer?.close();
      track.detach(video);
      video.pause();
      video.srcObject = null;
      canvas.remove();
    };
  }, [track]);
  return (
    <>
      <div ref={containerRef} className="program-foreground" aria-label="Presenter cutout" />
      {status && <span className="program-foreground-status">{status}</span>}
    </>
  );
}
