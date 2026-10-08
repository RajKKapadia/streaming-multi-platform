import { lazy, Suspense, useState, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
  useNavigate,
  useParams,
  useLocation,
} from "react-router-dom";
import { Room } from "livekit-client";
import type { JoinResponse } from "@studio/contracts";
import { Button } from "@studio/ui";
import { usePreferences } from "./store";
import { useCapture } from "./devices";
import { api, studioPath } from "./api";
import { Prejoin } from "./Prejoin";
import { Studio } from "./Studio";
import { studioPublishDefaults } from "./stream-quality";
const Broadcast = lazy(() =>
  import("./Broadcast").then((module) => ({ default: module.Broadcast })),
);
import "./styles.css";
import "../../../packages/studio/src/styles.css";
function App() {
  const location = useLocation();
  const capture = useCapture(),
    [room, setRoom] = useState<Room | null>(null),
    [joinData, setJoinData] = useState<JoinResponse | null>(null),
    [preview, setPreview] = useState(false);
  const resources = useRef({ room, tracks: capture.tracks });
  resources.current = { room, tracks: capture.tracks };
  useEffect(() => {
    if (location.pathname.startsWith("/join/") && resources.current.room) {
      void resources.current.room.disconnect(false);
      setRoom(null);
      setJoinData(null);
    }
  }, [location.pathname]);
  useEffect(
    () => () => {
      void resources.current.room?.disconnect();
      resources.current.tracks.forEach((track) => track.stop());
    },
    [],
  );
  const connect = async (data: JoinResponse) => {
    if (room) await room.disconnect(false);
    const p = usePreferences.getState();
    const instance = new Room({
      audioCaptureDefaults: {
        deviceId: p.microphoneId || undefined,
        echoCancellation: p.echo,
        noiseSuppression: true,
        autoGainControl: true,
      },
      adaptiveStream: true,
      dynacast: true,
      videoCaptureDefaults: {
        deviceId: p.cameraId || undefined,
        resolution: {
          width: p.resolution === "1080" ? 1920 : p.resolution === "720" ? 1280 : 854,
          height: Number(p.resolution),
          frameRate: p.fps,
        },
      },
      publishDefaults: studioPublishDefaults,
    });
    try {
      await instance.connect(data.url, data.token);
      void instance.startAudio().catch(() => {});
      const liveTracks = capture.tracks.filter(
        (track) => track.isMuted || track.mediaStreamTrack.readyState === "live",
      );
      capture.setTracks(liveTracks);
      for (const track of liveTracks) await instance.localParticipant.publishTrack(track);
      setJoinData(data);
      setRoom(instance);
      setPreview(false);
    } catch (e) {
      await instance.disconnect(false);
      throw e;
    }
  };
  const leave = () => {
    void room?.disconnect();
    capture.tracks.forEach((t) => t.stop());
    capture.setTracks([]);
    setRoom(null);
    setJoinData(null);
    setPreview(false);
  };
  return (
    <Routes>
      <Route path="/" element={<Navigate replace to="/join/personal" />} />
      <Route
        path="/join/:studioId"
        element={<Prejoin capture={capture} onJoin={connect} onPreview={() => setPreview(true)} />}
      />
      <Route
        path="/studio/:studioId"
        element={
          room || preview ? (
            <Studio
              room={room}
              joinData={joinData}
              capture={capture}
              preview={preview}
              onLeave={leave}
              onReconnect={connect}
            />
          ) : (
            <Resume connect={connect} preview={() => setPreview(true)} />
          )
        }
      />
      <Route
        path="/broadcast/:studioId"
        element={
          <Suspense fallback={null}>
            <Broadcast />
          </Suspense>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
function Resume({
  connect,
  preview,
}: {
  connect: (data: JoinResponse) => Promise<void>;
  preview: () => void;
}) {
  const { studioId = "personal" } = useParams(),
    navigate = useNavigate(),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <div className="resume-page">
      <h1>Return to your studio.</h1>
      <p>Your camera and microphone stay off until you enable them.</p>
      <Button
        disabled={busy}
        onClick={() => {
          setBusy(true);
          void api<JoinResponse>(studioPath(studioId, "join"), {})
            .then(connect)
            .catch((e) => setError(e.message))
            .finally(() => setBusy(false));
        }}
      >
        {busy ? "Connecting…" : "Reconnect to studio"}
      </Button>
      <Button variant="secondary" onClick={() => navigate(`/join/${studioId}`)}>
        Back to setup
      </Button>
      <button className="text-link" onClick={preview}>
        Explore interface preview
      </button>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
const root = import.meta.hot?.data.root ?? createRoot(document.getElementById("root")!);
if (import.meta.hot) import.meta.hot.data.root = root;
root.render(
  <BrowserRouter>
    <App />
  </BrowserRouter>,
);
