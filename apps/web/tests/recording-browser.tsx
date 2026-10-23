import { useState } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { Room, LocalVideoTrack, LocalAudioTrack, Track } from "livekit-client";
import type { JoinResponse } from "@studio/contracts";
import { Studio } from "../src/Studio";
import { useCapture } from "../src/devices";
import { api, studioPath } from "../src/api";
import "../src/styles.css";
import "../../../packages/studio/src/styles.css";

// Run only with the isolated API and disposable local LiveKit credentials described in README.
// Uses generated frames + a quiet sine wave; never asks for camera or microphone permission.
let studioId = `recording-check-${Date.now()}`;
function Check() {
  const capture = useCapture();
  const [session, setSession] = useState<{ room: Room; data: JoinResponse }>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function start() {
    setBusy(true);
    let room: Room | undefined;
    try {
      const previous = await api<{ studio: string } | null>("/session");
      if (previous?.studio && /^recording-check-\d+$/.test(previous.studio))
        studioId = previous.studio;
      await api("/session", {
        studio: studioId,
        name: "Generated recording check",
        passcode: "recording-verification-passcode",
      });
      const data = await api<JoinResponse>(studioPath(studioId, "join"), {});
      room = new Room({ adaptiveStream: false, dynacast: false });
      await room.connect(data.url, data.token);
      const canvas = document.createElement("canvas");
      canvas.width = 1280;
      canvas.height = 720;
      const context = canvas.getContext("2d")!;
      let frame = 0;
      const draw = setInterval(() => {
        context.fillStyle = "#142653";
        context.fillRect(0, 0, 1280, 720);
        context.fillStyle = "white";
        context.font = "36px sans-serif";
        context.fillText(`Generated recording check · frame ${frame++}`, 60, 80);
        context.fillStyle = "#7cdbff";
        context.fillRect((frame * 8) % 1100, 180, 100, 300);
      }, 1000 / 30);
      const camera = new LocalVideoTrack(
        canvas.captureStream(30).getVideoTracks()[0]!,
        undefined,
        true,
      );
      const audio = new AudioContext();
      await audio.resume();
      const destination = audio.createMediaStreamDestination();
      const oscillator = audio.createOscillator();
      const gain = audio.createGain();
      gain.gain.value = 0.05;
      oscillator.frequency.value = 440;
      oscillator.connect(gain).connect(destination);
      oscillator.start();
      const microphone = new LocalAudioTrack(
        destination.stream.getAudioTracks()[0]!,
        undefined,
        true,
      );
      await room.localParticipant.publishTrack(camera, {
        source: Track.Source.Camera,
        simulcast: false,
      });
      await room.localParticipant.publishTrack(microphone, { source: Track.Source.Microphone });
      capture.setTracks([camera, microphone]);
      room.once("disconnected", () => {
        clearInterval(draw);
        oscillator.stop();
        void audio.close();
      });
      setSession({ room, data });
    } catch (error) {
      await room?.disconnect();
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (!session)
    return (
      <main style={{ padding: 40 }}>
        <h1>Generated recording verification</h1>
        <p>
          Disposable local room. Generated video and audio. No streaming destination is enabled.
        </p>
        <button
          className="ui-button ui-button-primary"
          onClick={() => void start()}
          disabled={busy}
        >
          {busy ? "Connecting…" : "Open generated studio"}
        </button>
        <p role="alert">{error}</p>
      </main>
    );
  return (
    <MemoryRouter initialEntries={[`/studio/${studioId}`]}>
      <Routes>
        <Route
          path="/studio/:studioId"
          element={
            <Studio
              room={session.room}
              joinData={session.data}
              capture={capture}
              preview={false}
              onLeave={() => {
                void session.room.disconnect();
                setSession(undefined);
              }}
              onReconnect={async () => {}}
            />
          }
        />
      </Routes>
    </MemoryRouter>
  );
}
createRoot(document.getElementById("root")!).render(<Check />);
