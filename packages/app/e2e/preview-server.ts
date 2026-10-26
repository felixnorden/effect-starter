// @effect-diagnostics asyncFunction:off
/**
 * The shared preview harness: a temporary fixture copy and the app under test.
 * The bench, the a11y suite, and the scroll check all spawn the real app.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const repo = resolve(here, "../../..");

export const copyFixture = (
  fixture: string,
): { readonly file: string; readonly stop: () => void } => {
  const dir = mkdtempSync(join(tmpdir(), "preview-bench-"));
  const file = join(dir, "document.md");
  copyFileSync(resolve(repo, fixture), file);
  return { file, stop: () => rmSync(dir, { recursive: true, force: true }) };
};

/** Spawn the app on its fixed dev-only port and read the printed URL. */
export const startPreview = async (
  file: string,
): Promise<{ url: string; stop: () => Promise<void> }> => {
  const child: ChildProcess = spawn("bun", [resolve(here, "../src/main.ts"), "dev", file], {
    cwd: repo,
    stdio: ["ignore", "pipe", "pipe"],
  });

  const url = await new Promise<string>((resolveUrl, rejectUrl) => {
    let buffer = "";
    const timer = setTimeout(() => rejectUrl(new Error(`no URL from preview: ${buffer}`)), 30_000);
    child.stdout?.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();
      const match = /http:\/\/127\.0\.0\.1:\d+\//u.exec(buffer);
      if (match?.[0] !== undefined) {
        clearTimeout(timer);
        resolveUrl(match[0]);
      }
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      rejectUrl(new Error(`preview exited with ${code}: ${buffer}`));
    });
  });

  return {
    url,
    stop: async () => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      child.kill();
      const exited = await new Promise<boolean>((resolveStop) => {
        child.once("exit", () => resolveStop(true));
        setTimeout(() => resolveStop(false), 2_000);
      });
      if (exited) return;
      // The fixed dev port must be free before the next preview starts.
      child.kill("SIGKILL");
      await new Promise((resolveStop) => {
        child.once("exit", () => resolveStop(undefined));
        setTimeout(() => resolveStop(undefined), 2_000);
      });
    },
  };
};
