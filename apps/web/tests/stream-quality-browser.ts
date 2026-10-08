import { LocalVideoTrack, Room, RoomEvent, Track } from "livekit-client";
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { studioPublishDefaults, usePublishedVideo } from "../src/stream-quality";

const results = document.querySelector<HTMLPreElement>("#results")!;
const button = document.querySelector<HTMLButtonElement>("#run")!;
const report = (message: string) => {
  results.textContent += `${message}\n`;
};
const assert = (condition: boolean, message: string) => {
  if (!condition) throw new Error(message);
};
async function until(check: () => boolean, message: string) {
  const deadline = Date.now() + 15000;
  while (!check() && Date.now() < deadline)
    await new Promise((resolve) => setTimeout(resolve, 100));
  assert(check(), message);
}

function PublishedStatus({ camera, enabled }: { camera: LocalVideoTrack; enabled: boolean }) {
  const published = usePublishedVideo(camera, enabled);
  return createElement(
    "p",
    null,
    published
      ? `Sending ${published.frameWidth}x${published.frameHeight} at ${published.framesPerSecond} fps`
      : "Not publishing",
  );
}

button.onclick = async () => {
  button.disabled = true;
  results.textContent = "";
  const rooms: Room[] = [];
  const tracks: LocalVideoTrack[] = [];
  const diagnostics = document.createElement("div");
  document.body.append(diagnostics);
  const diagnosticsRoot = createRoot(diagnostics);
  const canvas = document.querySelector<HTMLCanvasElement>("#source")!;
  canvas.width = 1920;
  canvas.height = 1080;
  const context = canvas.getContext("2d")!;
  let frame = 0;
  const draw = setInterval(() => {
    context.fillStyle = "#142653";
    context.fillRect(0, 0, 1920, 1080);
    context.fillStyle = "#ffffff";
    context.font = "48px sans-serif";
    context.fillText(`Synthetic 1080p camera · frame ${frame++}`, 40, 80);
    context.fillRect((frame * 10) % 1800, 200, 100, 400);
  }, 1000 / 30);
  const makeTrack = (source: Track.Source) => {
    const track = new LocalVideoTrack(
      canvas.captureStream(30).getVideoTracks()[0]!,
      undefined,
      true,
    );
    track.source = source;
    tracks.push(track);
    return track;
  };
  try {
    const { url, oldToken, fixedToken, subscriberToken } = await fetch("/credentials").then((r) =>
      r.json(),
    );
    const receiver = new Room({ adaptiveStream: false });
    rooms.push(receiver);
    const video = document.querySelector<HTMLVideoElement>("#received")!;
    receiver.on(RoomEvent.TrackSubscribed, (track, publication) => {
      if (publication.source === Track.Source.Camera) track.attach(video);
    });
    await receiver.connect(url, subscriberToken);
    const { degradationPreference: _old, ...oldDefaults } = studioPublishDefaults;
    const old = new Room({ publishDefaults: oldDefaults, dynacast: true });
    rooms.push(old);
    await old.connect(url, oldToken);
    const oldCamera = makeTrack(Track.Source.Camera);
    await old.localParticipant.publishTrack(oldCamera);
    await until(
      () => oldCamera.sender?.getParameters().degradationPreference === "maintain-framerate",
      "The original camera policy was not reproduced.",
    );
    report("PASS: original SDK camera sender uses maintain-framerate (permits resolution loss).");
    await old.disconnect();

    const fixed = new Room({ publishDefaults: studioPublishDefaults, dynacast: true });
    rooms.push(fixed);
    await fixed.connect(url, fixedToken);
    const camera = makeTrack(Track.Source.Camera);
    const screen = makeTrack(Track.Source.ScreenShare);
    await fixed.localParticipant.publishTrack(camera);
    await fixed.localParticipant.publishTrack(screen);
    await until(
      () =>
        camera.sender?.getParameters().degradationPreference === "maintain-resolution" &&
        screen.sender?.getParameters().degradationPreference === "maintain-resolution",
      "The fixed camera/screen policy was not applied to the senders.",
    );
    report("PASS: camera and concurrent screen share use maintain-resolution on real RTP senders.");
    await until(
      () => video.videoWidth === 1920 && video.videoHeight === 1080 && video.readyState >= 2,
      "The receiver did not decode the full-resolution camera.",
    );
    report(`PASS: receiver decodes ${video.videoWidth} × ${video.videoHeight} camera video.`);
    diagnosticsRoot.render(createElement(PublishedStatus, { camera, enabled: true }));
    await until(
      () => diagnostics.textContent?.includes("Sending 1920x1080") === true,
      "Camera diagnostics did not report the highest active outgoing layer.",
    );
    report("PASS: camera diagnostics report actual 1920x1080 outgoing video from RTP stats.");
    diagnosticsRoot.render(createElement(PublishedStatus, { camera, enabled: false }));
    await until(
      () => diagnostics.textContent === "Not publishing",
      "Closing diagnostics did not clear the previous outgoing stats.",
    );
    await camera.mute();
    await camera.unmute();
    assert(
      camera.sender?.getParameters().degradationPreference === "maintain-resolution",
      "Camera mute/unmute lost the quality policy.",
    );
    await fixed.localParticipant.unpublishTrack(camera);
    const replacement = makeTrack(Track.Source.Camera);
    await fixed.localParticipant.publishTrack(replacement);
    await until(
      () => replacement.sender?.getParameters().degradationPreference === "maintain-resolution",
      "Republishing a camera lost the quality policy.",
    );
    report("PASS: camera mute/unmute and republishing retain the quality policy.");
    report("PASS: synthetic LiveKit transport checks complete; no platform broadcast was started.");
  } catch (error) {
    report(`FAIL: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    clearInterval(draw);
    diagnosticsRoot.unmount();
    diagnostics.remove();
    await Promise.all(rooms.map((room) => room.disconnect()));
    tracks.forEach((track) => track.stop());
    button.disabled = false;
  }
};
