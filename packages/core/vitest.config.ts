import { defineConfig } from "vitest/config";

// Tests run in plain Node. This package has no I/O and no framework, so the
// config stays plugin-free and the only environment a test sees is the fixed
// record passed to `Greeting.layerFromEnv`.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
