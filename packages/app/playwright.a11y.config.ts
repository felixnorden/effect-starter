import { defineConfig } from "@playwright/test";

// One worker: the preview binds one port and the contrast samples must not
// contend. The files live outside the bench config, so `bench:browser` and its
// stored baseline are untouched.
export default defineConfig({
  testDir: "e2e-a11y",
  workers: 1,
  fullyParallel: false,
  timeout: 180_000,
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  reporter: [["list"]],
});
