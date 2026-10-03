import { initialState, type VisualPreset } from "@studio/contracts";
import { create } from "zustand";
import { persist } from "zustand/middleware";
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
  backgroundId: string;
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
      backgroundId: "",
      set: (value) => set(value),
    }),
    { name: "studio-preferences-v1" },
  ),
);
