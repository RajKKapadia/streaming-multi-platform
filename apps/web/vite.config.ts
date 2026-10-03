import { resolve } from "node:path";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, resolve(import.meta.dirname, "../.."), "");
  const apiUrl = `http://127.0.0.1:${process.env.PORT || env.PORT || 3001}`;
  return {
    resolve: { dedupe: ["react", "react-dom", "livekit-client"] },
    plugins: [react(), tailwindcss()],
    server: {
      port: 5173,
      proxy: { "/api": apiUrl, "/media": apiUrl },
    },
  };
});
