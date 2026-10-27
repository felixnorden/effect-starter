#!/usr/bin/env bun
/**
 * PF-1 and PF-2 with the machine and the commit beside every number.
 *
 * PF-1: `nvim --startuptime` with and without the plugin, over 10 runs, plus
 * the no-process check. PF-2: 20 spawns, each timed from spawn to the server's
 * bind log line (epoch ms, no address). Spawn to `ready` is reported as a
 * finding, not a budget.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import * as os from "node:os";
import path from "node:path";

import {
  kill,
  lineReader,
  root,
  spawnEditor,
  waitExit,
  waitForBind,
  waitForFrame,
  writeLine,
  type ReadyFrame,
} from "./editor-process.ts";

const dir = mkdtempSync(path.join(tmpdir(), "mdv-editor-bench-"));
const pluginDir = path.join(root, "editor/nvim");
const kitchenSink = readFileSync(path.join(root, "fixtures/kitchen-sink.md"), "utf8");

const median = (values: readonly number[]): number => {
  const sorted = values.toSorted((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
    : (sorted[middle] ?? 0);
};

const percentile = (values: readonly number[], fraction: number): number => {
  const sorted = values.toSorted((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1));
  return sorted[index] ?? 0;
};

const startupTime = (withPlugin: boolean, run: number): number => {
  const file = path.join(dir, `startup-${withPlugin ? "plugin" : "plain"}-${run}.log`);
  const command = [
    "nvim",
    "--headless",
    "--startuptime",
    file,
    "-u",
    "NONE",
    ...(withPlugin
      ? ["--cmd", `set runtimepath+=${pluginDir}`, "--cmd", "runtime plugin/markdown_viewer.vim"]
      : []),
    "-c",
    "qall!",
  ];
  const result = Bun.spawnSync({
    cmd: command,
    cwd: root,
    stdin: "ignore",
    stdout: "ignore",
    stderr: "ignore",
  });
  if (result.exitCode !== 0) throw new Error(`nvim --startuptime exited ${result.exitCode}`);
  const last = readFileSync(file, "utf8")
    .trimEnd()
    .split("\n")
    .findLast((line) => /^\s*\d+\.\d+/.test(line));
  const value = last?.match(/^\s*(\d+\.\d+)/)?.[1];
  if (value === undefined) throw new Error(`no timing in ${file}`);
  return Number(value);
};

const machine = `${os.platform()} ${os.release()} ${os.arch()} / ${
  os.cpus()[0]?.model ?? "unknown CPU"
}`;
const commit =
  Bun.spawnSync({ cmd: ["git", "rev-parse", "--short", "HEAD"], cwd: root })
    .stdout.toString()
    .trim() || "unknown";

console.log(`machine: ${machine}`);
console.log(`commit: ${commit}`);

// PF-1
const plain: number[] = [];
const plugin: number[] = [];
for (let run = 0; run < 10; run += 1) {
  plain.push(startupTime(false, run));
  plugin.push(startupTime(true, run));
}
const plainMedian = median(plain);
const pluginMedian = median(plugin);
const delta = pluginMedian - plainMedian;

const pgrep = Bun.spawnSync({
  cmd: ["pgrep", "-f", "packages/app/src/main.ts editor"],
  stdin: "ignore",
  stdout: "pipe",
  stderr: "pipe",
});
const noProcess = pgrep.exitCode !== 0;

console.log(
  `PF-1: nvim --startuptime median without=${plainMedian.toFixed(3)}ms with=${pluginMedian.toFixed(3)}ms delta=${delta.toFixed(3)}ms`,
);
console.log(`PF-1: no server process before the first command: ${noProcess}`);

// PF-2
const documents = JSON.stringify({
  _tag: "document",
  editorProtocolVersion: 1,
  path: path.join(root, "fixtures/kitchen-sink.md"),
  text: kitchenSink,
});

const bindSamples: number[] = [];
const readySamples: number[] = [];
for (let run = 0; run < 20; run += 1) {
  const log = path.join(dir, `bench-${run}.log`);
  const started = Date.now();
  const proc = spawnEditor(log);
  try {
    const lines = lineReader(proc.stdout);
    writeLine(proc, `${documents}\n`);
    await waitForFrame<ReadyFrame>(lines, (value) => value._tag === "ready", 30_000);
    const readyMs = Date.now() - started;
    const bindEpoch = await waitForBind(log, 10_000);
    bindSamples.push(bindEpoch - started);
    readySamples.push(readyMs);
    lines.cancel();
    proc.stdin.end();
    await waitExit(proc, 10_000);
  } catch (cause) {
    await kill(proc);
    throw cause;
  }
}

const bindP50 = percentile(bindSamples, 0.5);
const bindP95 = percentile(bindSamples, 0.95);
const readyP50 = percentile(readySamples, 0.5);
const readyP95 = percentile(readySamples, 0.95);

console.log(
  `PF-2: spawn-to-bind over 20 runs p50=${bindP50.toFixed(0)}ms p95=${bindP95.toFixed(0)}ms (budget 300ms)`,
);
console.log(
  `finding: spawn-to-ready over the same 20 runs p50=${readyP50.toFixed(0)}ms p95=${readyP95.toFixed(0)}ms`,
);

rmSync(dir, { recursive: true, force: true });

const failures: string[] = [];
if (delta > 10) failures.push(`PF-1 delta ${delta.toFixed(3)}ms exceeds 10ms`);
if (!noProcess) failures.push("PF-1 found a server process before the first command");
if (bindP95 > 300) failures.push(`PF-2 p95 ${bindP95.toFixed(0)}ms exceeds 300ms`);

if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL ${failure}`);
  process.exit(1);
}

console.log("OK editor bench");
