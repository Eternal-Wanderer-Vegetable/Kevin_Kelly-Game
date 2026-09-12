import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The dashboard is a small hash-routed SPA served by the harness webui server
// from dist/webui; during development `npm run dev:web` proxies /api to a
// locally running `npm run webui`.
export default defineConfig({
  root: "webui",
  plugins: [react()],
  base: "./",
  build: {
    outDir: "../dist/webui",
    emptyOutDir: true,
  },
  server: {
    proxy: {
      "/api": "http://127.0.0.1:8080",
    },
  },
});
