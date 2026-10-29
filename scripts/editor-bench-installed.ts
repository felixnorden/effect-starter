#!/usr/bin/env bun
/**
 * PF-2 for the installed server: 20 spawns of bin/mdv-<os>-<arch>, each timed
 * from spawn to the bind log line and to the `ready` frame. The source bench
 * remains the baseline; this one proves the compiled artifact.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import * as os from "node:os";
import path from "node:path";

import {
  kill,
  lineReader,
  root,
  waitExit,
  waitForBind,
  waitForFrame,
  writeLine,
  type ReadyFrame,
} from "./editor-process.ts";

const platform =
  process.platform === "darwin" ? "darwin" : process.platform === "win32" ? "win32" : "linux";
const arch = process.arch === "arm64" ? "arm64" : "x64";
const suffix = platform === "win32" ? ".exe" : "";
const binary = path.join(root, "packages/editor/bin", `mdv-${platform}-${arch}${suffix}`);
const client = path.join(path.dirname(binary), "client", "index.html");

if (!existsSync(binary)) {
  console.error(`FAIL missing ${path.relative(root, binary)}; run bun run build:server`);
  process.exit(1);
}
if (!existsSync(client)) {
  console.error(`FAIL missing ${path.relative(root, client)}; run bun run build:server`);
  process.exit(1);
}

const dir = mkdtempSync(path.join(tmpdir(), "mdv-editor-installed-"));
const kitchenSink = readFileSync(path.join(root, "fixtures/kitchen-sink.md"), "utf8");
const document = JSON.stringify({
  _tag: "document",
  editorProtocolVersion: 1,
  path: path.join(root, "fixtures/kitchen-sink.md"),
  text: kitchenSink,
});

const percentile = (values: readonly number[], fraction: number): number => {
  const sorted = values.toSorted((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1));
  return sorted[index] ?? 0;
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
console.log(`server: ${path.relative(root, binary)}`);

const bindSamples: number[] = [];
const readySamples: number[] = [];

for (let run = 0; run < 20; run += 1) {
  const log = path.join(dir, `installed-${run}.log`);
  const started = Date.now();
  const proc = Bun.spawn({
    cmd: [binary, "editor", "--log-file", log],
    cwd: root,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });

  try {
    const lines = lineReader(proc.stdout);
    writeLine(proc, `${document}\n`);
    await waitForFrame<ReadyFrame>(lines, (value) => value._tag === "ready", 30_000);
    readySamples.push(Date.now() - started);
    const bindEpoch = await waitForBind(log, 10_000);
    bindSamples.push(bindEpoch - started);
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
  `PF-2 installed: spawn-to-bind over 20 runs p50=${bindP50.toFixed(0)}ms p95=${bindP95.toFixed(0)}ms (budget 300ms)`,
);
console.log(
  `finding: spawn-to-ready over the same 20 runs p50=${readyP50.toFixed(0)}ms p95=${readyP95.toFixed(0)}ms`,
);

rmSync(dir, { recursive: true, force: true });

const failures: string[] = [];
if (bindP95 > 300) failures.push(`PF-2 installed p95 ${bindP95.toFixed(0)}ms exceeds 300ms`);

if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL ${failure}`);
  process.exit(1);
}

console.log("OK installed editor bench");
