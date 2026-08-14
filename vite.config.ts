import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "node:path";

const host = process.env.TAURI_DEV_HOST;

// Port 1440: deliberately neither standalone app's port (recorder 1430,
// PPS 1420), so the suite and the old apps can run dev servers side by side
// during the transition.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  server: {
    port: 1440,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 1441 } : undefined,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  build: {
    rollupOptions: {
      // One HTML entry per mode. preview.html (the PPS screen-jumper dev
      // panel, arriving in phase 2) must NEVER be listed here: anything in
      // this map ships in the installer, and that panel is dev-only. The dev
      // server serves root HTML files regardless of this list.
      input: {
        launcher: resolve(__dirname, "index.html"),
        recorder: resolve(__dirname, "recorder.html"),
        station: resolve(__dirname, "station.html"),
      },
    },
  },
});
