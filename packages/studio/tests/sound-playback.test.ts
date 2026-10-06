import { expect, test } from "bun:test";
import type { Playback } from "@studio/contracts";
import { SoundPlayback } from "../src/sound-playback";

const cue = (id = "bong"): Playback => ({
  id,
  assetId: "sound",
  startedAt: 1000,
  position: 0,
  duration: 0.123,
  playing: true,
  loop: false,
  volume: 1,
});

test("a delayed short cue survives shared expiry and does not replay after ending", () => {
  const player = new SoundPlayback(),
    p = cue();
  expect(player.update(p, 1350)).toEqual({ playback: p, restart: true });
  expect(player.update(null, 1400).playback).toBe(p);
  player.finish();
  expect(player.update(p, 1500)).toEqual({ playback: null, restart: false });
  expect(player.update(cue("retrigger"), 1550).restart).toBe(true);
});

test("explicit stop, pause, volume, and resume retain their meaning", () => {
  const player = new SoundPlayback(),
    p = { ...cue(), duration: 3 };
  player.update(p, 1000);
  const paused = { ...p, playing: false, position: 0.1, startedAt: 1100, volume: 0.4 };
  expect(player.update(paused, 1100)).toEqual({ playback: paused, restart: false });
  const resumed = { ...paused, playing: true, startedAt: 1200 };
  expect(player.update(resumed, 1200)).toEqual({ playback: resumed, restart: false });
  expect(player.update(null, 1250).playback).toBeNull();
  expect(player.update(resumed, 1300).playback).toBeNull();
});

test("looping effects stop on removal and old room metadata does not play", () => {
  const player = new SoundPlayback(),
    loop = { ...cue(), loop: true };
  expect(player.update(loop, 1000).playback).toBe(loop);
  expect(player.update(null, 2000).playback).toBeNull();
  expect(player.update(cue("stale"), 7000).playback).toBeNull();
});

test("a different effect or a clip cancels a tail retained after shared expiry", () => {
  const player = new SoundPlayback(),
    p = cue();
  player.update(p, 1350);
  expect(player.update(null, 1400).playback).toBe(p);
  expect(player.update(null, 1450, true).playback).toBeNull();
  expect(player.update(p, 1500).restart).toBe(false);
});

test("a paused cue skipped on reconnect can still be resumed by a fresh update", () => {
  const player = new SoundPlayback(),
    paused = { ...cue(), playing: false };
  expect(player.update(paused, 7000).playback).toBeNull();
  const resumed = { ...paused, playing: true, startedAt: 8000 };
  expect(player.update(resumed, 8000)).toEqual({ playback: resumed, restart: true });
});
