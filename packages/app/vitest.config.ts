import { defineConfig } from "vitest/config";

// The app's CLI and render-command tests run in plain Node, like core's.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
});
