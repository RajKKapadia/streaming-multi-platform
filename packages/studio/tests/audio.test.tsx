import { test, expect } from "bun:test";
import { Track } from "livekit-client";
import { renderToStaticMarkup } from "react-dom/server";
import { initialState, layouts, type StudioState } from "@studio/contracts";
import { programVoices, ProgramCanvas, type Source } from "../src";
const sources: Source[] = ["host", "guest-1", "guest-2", "guest-3"].map((identity, i) => ({
  identity,
  name: `Person ${i}`,
  cameraMuted: true,
  microphone: { sid: `mic-${i}` } as Track,
}));
test("backstage voices are excluded, and invisible staged cameras retain audio", () => {
  const state = {
    ...initialState(),
    participants: ["host", "guest-1", "guest-2"],
    featured: "host",
    layout: "solo" as const,
  };
  expect(programVoices(state, sources)).toHaveLength(3);
  expect(programVoices(state, sources)).not.toContain(sources[3]!.microphone);
  const clip = {
    id: "clip",
    assetId: "c",
    startedAt: Date.now(),
    duration: 100,
    position: 0,
    volume: 1,
    loop: false,
    playing: true,
  };
  expect(programVoices({ ...state, clip }, sources)).toEqual([]);
  expect(sources[0]!.microphone?.sid).toBe("mic-0");
});
test("all eight layouts render with four camera-off humans and a selected screen", () => {
  const state: StudioState = {
    ...initialState(),
    participants: sources.map((s) => s.identity),
    featured: "guest-2",
    screen: { identity: "host", sid: "screen" },
  };
  for (const layout of layouts) {
    const html = renderToStaticMarkup(
      <ProgramCanvas state={{ ...state, layout: layout.id }} sources={sources} assets={[]} />,
    );
    expect(html).toContain("program-logical");
    if (layout.screen) expect(html).toContain("program-screen");
    else expect(html).toContain("program-camera");
  }
});
