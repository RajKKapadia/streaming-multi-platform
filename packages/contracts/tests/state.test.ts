import { describe, test, expect } from "bun:test";
import {
  applyCommand,
  initialState,
  playbackPosition,
  settleState,
  nextPlaybackEnd,
  type Command,
} from "../src";
describe("program transitions", () => {
  test("only playing, finite media schedules a program redraw, including music resumed after a clip", () => {
    let s = initialState();
    expect(nextPlaybackEnd(s)).toBeNull();
    s = applyCommand(
      s,
      { type: "play", channel: "music", assetId: "m", duration: 20, loop: true, volume: 1 },
      1000,
    );
    expect(nextPlaybackEnd(s)).toBeNull();
    s = applyCommand(s, { type: "loop", channel: "music", loop: false }, 5000);
    expect(nextPlaybackEnd(s)).toBe(21000);
    s = applyCommand(
      s,
      { type: "play", channel: "clip", assetId: "c", duration: 5, loop: false, volume: 1 },
      6000,
    );
    expect(nextPlaybackEnd(s)).toBe(11000);
    const before = structuredClone(s);
    const finished = settleState(s, 11000);
    expect(s).toEqual(before);
    expect(finished.clip).toBeNull();
    expect(nextPlaybackEnd(finished)).toBe(26000);
    const paused = applyCommand(
      finished,
      { type: "playback", channel: "music", action: "pause" },
      12000,
    );
    expect(nextPlaybackEnd(paused)).toBeNull();
    expect(settleState(paused, 90000)).toBe(paused);
  });
  test("stage order, feature, capacity and selected screen termination", () => {
    let s = initialState();
    for (const identity of ["host", "guest-1", "guest-2", "guest-3"])
      s = applyCommand(s, { type: "stage.add", identity }, 0);
    expect(() => applyCommand(s, { type: "stage.add", identity: "guest-4" }, 0)).toThrow("four");
    s = applyCommand(s, { type: "feature", identity: "guest-2" }, 0);
    s = applyCommand(s, { type: "stage.remove", identity: "guest-2" }, 0);
    expect(s.participants).toEqual(["host", "guest-1", "guest-3"]);
    expect(s.featured).toBe("host");
    expect(() => applyCommand(s, { type: "layout", layout: "pip" }, 0)).toThrow("screen");
    s = applyCommand(s, { type: "screen", screen: { identity: "guest-1", sid: "screen" } }, 0);
    s = applyCommand(s, { type: "layout", layout: "pip" }, 0);
    s = applyCommand(s, { type: "screen", screen: null }, 0);
    expect(s.layout).toBe("grid");
  });
  test("clips suspend music and effects, and resume the saved music position", () => {
    const play = (channel: "music" | "clip" | "sound", duration = 100): Command => ({
      type: "play",
      channel,
      assetId: channel,
      duration,
      loop: false,
      volume: 0.5,
    });
    let s = applyCommand(initialState(), play("music"), 1000);
    s = applyCommand(s, play("sound"), 2000);
    s = applyCommand(s, play("clip", 5), 11000);
    expect(s.music?.position).toBe(10);
    expect(s.music?.playing).toBe(false);
    expect(s.sound).toBeNull();
    expect(s.resumeMusicAfterClip).toBe(true);
    expect(() =>
      applyCommand(s, { type: "playback", channel: "music", action: "resume" }, 12000),
    ).toThrow("clip");
    const late = settleState(s, 18000);
    expect(late.clip).toBeNull();
    expect(late.music?.playing).toBe(true);
    expect(playbackPosition(late.music!, 18000)).toBe(12);
    const stopped = applyCommand(s, { type: "playback", channel: "clip", action: "stop" }, 12000);
    expect(playbackPosition(stopped.music!, 12000)).toBe(10);
    expect(stopped.participants).toEqual(s.participants);
  });
  test("staging a screen displays it immediately and preserves a selected screen layout", () => {
    let s = applyCommand(initialState(), { type: "stage.add", identity: "host" }, 0);
    s = applyCommand(s, { type: "screen", screen: { identity: "host", sid: "host-screen" } }, 0);
    expect(s.layout).toBe("screen-presenter");
    expect(s.participants).toEqual(["host"]);
    s = applyCommand(s, { type: "layout", layout: "screen-rail" }, 0);
    s = applyCommand(
      s,
      { type: "screen", screen: { identity: "guest-1", sid: "guest-screen" } },
      0,
    );
    expect(s.layout).toBe("screen-rail");
    expect(s.screen?.identity).toBe("guest-1");
    s = applyCommand(s, { type: "screen", screen: null }, 0);
    expect(s.layout).toBe("grid");
  });
  test("paused music stays paused; loops and reconnects preserve the timeline", () => {
    let s = applyCommand(
      initialState(),
      { type: "play", channel: "music", assetId: "m", duration: 30, loop: true, volume: 0.2 },
      0,
    );
    expect(playbackPosition(s.music!, 65000)).toBe(5);
    s = applyCommand(s, { type: "playback", channel: "music", action: "pause" }, 65000);
    s = applyCommand(
      s,
      { type: "play", channel: "clip", assetId: "c", duration: 5, loop: false, volume: 1 },
      65000,
    );
    s = settleState(s, 80000);
    expect(s.music?.playing).toBe(false);
    expect(s.music?.position).toBe(5);
    expect(settleState(s, 90000)).toBe(s);
  });
  test("turning a loop off preserves the current cycle and lets it finish", () => {
    let s = applyCommand(
      initialState(),
      { type: "play", channel: "music", assetId: "music", duration: 30, loop: true, volume: 0.3 },
      0,
    );
    s = applyCommand(s, { type: "loop", channel: "music", loop: false }, 65000);
    expect(playbackPosition(s.music!, 65000)).toBe(5);
    expect(s.music?.loop).toBe(false);
    expect(settleState(s, 90000).music).toBeNull();
  });
});
