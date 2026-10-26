import { defineConfig } from "@playwright/test";

// One worker: the timings must not contend, and the preview binds one port.
export default defineConfig({
  testDir: "e2e",
  workers: 1,
  fullyParallel: false,
  timeout: 180_000,
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  reporter: [["list"]],
});
