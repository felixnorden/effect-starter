import { Effect } from "effect";

/** Open the URL with argv per platform, never a shell string. */
export const openBrowser = (url: string): Effect.Effect<void> =>
  Effect.sync(() => {
    const command =
      process.platform === "darwin"
        ? ["open", url]
        : process.platform === "win32"
          ? ["cmd", "/c", "start", "", url]
          : ["xdg-open", url];

    Bun.spawn(command, { stdout: "ignore", stderr: "ignore" });
  });
