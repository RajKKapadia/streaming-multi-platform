import { initialState, type VisualPreset } from "@studio/contracts";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { CameraForegroundMode } from "./background-processor";
type Preferences = {
  visual: VisualPreset;
  name: string;
  cameraId: string;
  microphoneId: string;
  mirror: boolean;
  echo: boolean;
  resolution: "1080" | "720" | "480";
  fps: 30 | 60;
  effect: "none" | "blur" | "image";
  foregroundMode: CameraForegroundMode;
  blurRadius: number;
  backgroundId: string;
  localBackground: { url: string; name: string } | null;
  set: (value: Partial<Omit<Preferences, "set">>) => void;
};
export const usePreferences = create<Preferences>()(
  persist(
    (set) => ({
      visual: {
        layout: "solo",
        background: initialState().background,
        logo: initialState().logo,
        overlay: initialState().overlay,
      },
      name: "",
      cameraId: "",
      microphoneId: "",
      mirror: true,
      echo: true,
      resolution: "1080",
      fps: 60,
      effect: "none",
      foregroundMode: "stable",
      blurRadius: 12,
      backgroundId: "",
      localBackground: null,
      set: (value) => set(value),
    }),
    {
      name: "studio-preferences-v1",
      partialize: ({ localBackground, ...preferences }) => ({
        ...preferences,
        effect: localBackground && preferences.effect === "image" ? "none" : preferences.effect,
      }),
    },
  ),
);
