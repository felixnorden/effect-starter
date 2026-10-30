#!/usr/bin/env bun
/**
 * One command, both adapters, the same committed bytes. Runs each adapter's
 * conformance script headless against the golden frames and the shared discovery
 * cases. `SKIP` names the missing binary and the reason; a missing adapter file
 * with its binary present is a failure.
 */
import { existsSync } from "node:fs";
import path from "node:path";

import { root } from "./editor-process.ts";

interface Runner {
  readonly label: string;
  readonly binary: string;
  readonly adapter: string;
  readonly command: readonly string[];
}

const run = (runner: Runner): boolean => {
  const version = Bun.spawnSync({
    cmd: [runner.binary, "--version"],
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const firstLine =
    version.stdout.toString().split("\n")[0] ?? `${runner.binary} (unknown version)`;
  console.log(`${runner.label}: ${firstLine.trim()}`);

  if (!existsSync(runner.adapter)) {
    console.log(`FAIL ${runner.label}: missing adapter ${path.relative(root, runner.adapter)}`);
    return false;
  }

  const result = Bun.spawnSync({
    cmd: [...runner.command],
    cwd: root,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const output = `${result.stdout.toString()}${result.stderr.toString()}`.trimEnd();
  if (output !== "") console.log(output);
  if (result.exitCode !== 0) {
    console.log(`FAIL ${runner.label}: exit ${result.exitCode}`);
    return false;
  }
  return true;
};

const runners: readonly Runner[] = [
  {
    label: "nvim",
    binary: "nvim",
    adapter: path.join(root, "packages/editor/nvim/tests/conformance.lua"),
    command: [
      "nvim",
      "--headless",
      "-u",
      "NONE",
      "-l",
      path.join(root, "packages/editor/nvim/tests/conformance.lua"),
    ],
  },
  {
    label: "nvim cursor cases",
    binary: "nvim",
    adapter: path.join(root, "packages/editor/tests/cursor-driver.lua"),
    command: [
      "nvim",
      "--headless",
      "-u",
      "NONE",
      "-l",
      path.join(root, "packages/editor/tests/cursor-driver.lua"),
    ],
  },
  {
    label: "vim",
    binary: "vim",
    adapter: path.join(root, "packages/editor/vim/tests/conformance.vim"),
    command: [
      "vim",
      "-u",
      "NONE",
      "-N",
      "-es",
      "-S",
      path.join(root, "packages/editor/vim/tests/conformance.vim"),
    ],
  },
  {
    label: "vim cursor cases",
    binary: "vim",
    adapter: path.join(root, "packages/editor/tests/cursor-driver.vim"),
    command: [
      "vim",
      "-u",
      "NONE",
      "-N",
      "-es",
      "-S",
      path.join(root, "packages/editor/tests/cursor-driver.vim"),
    ],
  },
];

let failed = false;
let ran = 0;

for (const runner of runners) {
  if (Bun.which(runner.binary) === null) {
    console.log(`SKIP ${runner.label}: no ${runner.binary} binary on PATH`);
    continue;
  }
  ran += 1;
  failed = !run(runner) || failed;
}

if (ran === 0) {
  console.log("SKIP editor conformance: no editor binary on PATH");
  process.exit(0);
}

if (failed) {
  console.error("FAIL editor conformance");
  process.exit(1);
}

console.log("OK editor conformance");
