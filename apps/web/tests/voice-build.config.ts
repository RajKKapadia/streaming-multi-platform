import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Build the same audio code/worker/assets as production, with a generated-audio test entry.
export default defineConfig({
  root: resolve(import.meta.dirname, ".."),
  resolve: { dedupe: ["react", "react-dom", "livekit-client"] },
  plugins: [react(), tailwindcss()],
  build: {
    outDir: resolve(import.meta.dirname, "../../..", ".local/voice-browser"),
    emptyOutDir: true,
    rollupOptions: { input: resolve(import.meta.dirname, "voice.html") },
  },
  preview: { host: "127.0.0.1", port: 5175, strictPort: true },
});
