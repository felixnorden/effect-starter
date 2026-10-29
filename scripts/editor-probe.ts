#!/usr/bin/env bun
/**
 * Report the editor floor: the version line, a golden frame and a 1 MB
 * document through the generated codec, line-channel delivery, and the `<Cmd>`
 * patch verdict. No binary or no generated frame prints `SKIP` and exits `0`;
 * a probe that runs and fails exits `1`.
 */
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = path.join(root, "fixtures/generated/editor-frames/cases.json");

// One megabyte on one line: the channel-delivery risk both adapters share.
const probeDir = mkdtempSync(path.join(tmpdir(), "mdv-editor-probe-"));
const lineFile = path.join(probeDir, "one-megabyte-line.txt");
writeFileSync(lineFile, `${"a".repeat(1024 * 1024)}\n`);
const env = { ...process.env, MDV_PROBE_LINE_FILE: lineFile };

const run = (label: string, command: readonly string[]): boolean => {
  const result = Bun.spawnSync({
    cmd: [...command],
    cwd: root,
    env,
    // Ex mode reads standard input; an inherited terminal hangs the probe.
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const output = `${result.stdout.toString()}${result.stderr.toString()}`.trimEnd();
  if (output !== "") console.log(output);
  if (result.exitCode !== 0) {
    console.log(`FAIL ${label}: exit ${result.exitCode}`);
    return false;
  }
  return true;
};

if (!existsSync(manifest)) {
  rmSync(probeDir, { recursive: true, force: true });
  console.log(`SKIP editor probe: ${manifest} is missing; run bun run frames:generate`);
  process.exit(0);
}

const nvim = Bun.which("nvim");
const vim = Bun.which("vim");
let failed = false;
let ran = 0;

if (nvim === null) {
  console.log("SKIP nvim: no nvim binary on PATH");
} else {
  ran += 1;
  failed =
    !run("nvim", [
      nvim,
      "--headless",
      "-u",
      path.join(root, "packages/editor/tests/minimal.lua"),
      "-l",
      path.join(root, "packages/editor/tests/probe.lua"),
    ]) || failed;
}

if (vim === null) {
  console.log("SKIP vim: no vim binary on PATH");
} else {
  ran += 1;
  failed =
    !run("vim", [
      vim,
      "-u",
      "NONE",
      "-N",
      "-es",
      "-S",
      path.join(root, "packages/editor/tests/probe.vim"),
    ]) || failed;
}

if (ran === 0) {
  console.log("SKIP editor probe: no editor binary on PATH");
}

rmSync(probeDir, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
