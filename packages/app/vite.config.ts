import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

import { DEV_PORT } from "./src/dev-config.ts";

// Absolute paths keep a build started from the repo root correct.
const here = (path: string): string => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  plugins: [react()],
  root: here("./src/client"),
  base: "/",
  build: {
    outDir: here("./dist/client"),
    emptyOutDir: true,
  },
  server: {
    // Dev-only: both routes target the fixed dev port; the proxy never reaches
    // the build output.
    proxy: {
      "/ws": { target: `http://127.0.0.1:${DEV_PORT}`, ws: true },
      "/local": { target: `http://127.0.0.1:${DEV_PORT}` },
    },
  },
});
