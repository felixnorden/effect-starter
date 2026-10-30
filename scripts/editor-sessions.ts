// @effect-diagnostics asyncFunction:off
/**
 * The real two-buffer session evidence: one headless editor per language, real
 * jobs, one server per row. Prints the mode it ran so a green run cannot claim
 * more.
 */
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const repo = resolve(import.meta.dir, "..");

const run = (command: string, args: readonly string[]): number => {
  const result = spawnSync(command, args, { cwd: repo, stdio: "inherit" });
  return result.status ?? 1;
};

const installed = (command: string): boolean =>
  spawnSync(command, ["--version"], { stdio: "ignore" }).status === 0;

let ran = false;
let code = 0;

if (installed("nvim")) {
  ran = true;
  const status = run("nvim", [
    "--headless",
    "-u",
    "NONE",
    "-l",
    "packages/editor/tests/sessions-driver.lua",
  ]);
  if (status !== 0) {
    code = status;
  }
}

if (installed("vim")) {
  ran = true;
  const status = run("vim", [
    "-u",
    "NONE",
    "-N",
    "-es",
    "-S",
    "packages/editor/tests/sessions-driver.vim",
  ]);
  if (status !== 0) {
    code = status;
  }
}

if (!ran) {
  console.log("SKIP editor:sessions: neither nvim nor vim is installed");
}

process.exit(code);
