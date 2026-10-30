#!/usr/bin/env bun
/**
 * Run the health report in both adapters and compare it with the shared field
 * order. The report is the only contract; values may differ per editor.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

import cases from "../packages/editor/tests/config-cases.json" with { type: "json" };

const root = new URL("..", import.meta.url).pathname;
const nvimRuntime = `${root}packages/editor/nvim`;
const vimRuntime = `${root}packages/editor/vim`;

interface Entry {
  readonly key: string;
  readonly value: string;
  readonly fix: string | null;
}

const failure = (message: string): never => {
  console.error(`FAIL editor:health: ${message}`);
  process.exit(1);
};

const selected = (): readonly ("nvim" | "vim")[] => {
  const index = process.argv.indexOf("--editor");
  const value = index === -1 ? "both" : process.argv[index + 1];
  if (value === "nvim") return ["nvim"];
  if (value === "vim") return ["vim"];
  if (value === "both") return ["nvim", "vim"];
  return failure(`--editor expects both, nvim or vim; received ${value ?? "(none)"}`);
};

const run = (command: string, args: readonly string[]) => {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    timeout: 120_000,
    env: { ...process.env, MDV_HEALTH_NO_SERVER: process.argv.includes("--no-server") ? "1" : "" },
  });
  if (result.error !== undefined) return { ok: false as const, error: result.error.message };
  if (result.status !== 0) {
    return {
      ok: false as const,
      error: `${command} exited ${result.status}: ${(result.stderr || result.stdout).trim()}`,
    };
  }
  return { ok: true as const, stdout: result.stdout };
};

const nvimReport = (): readonly Entry[] => {
  const result = run("nvim", [
    "--headless",
    "-u",
    "NONE",
    "--cmd",
    `set rtp+=${nvimRuntime}`,
    "-c",
    'lua io.write(vim.json.encode(require("markdown_viewer.health").report()))',
    "-c",
    "q",
  ]);
  if (!result.ok) return failure(`nvim: ${result.error}`);
  try {
    return JSON.parse(result.stdout) as Entry[];
  } catch {
    return failure(`nvim printed no JSON: ${result.stdout.slice(0, 120)}`);
  }
};

const vimReport = (): readonly Entry[] => {
  const out = "/tmp/mdv-vim-health.json";
  const result = run("vim", [
    "-u",
    "NONE",
    "-N",
    "-es",
    "--cmd",
    `set rtp+=${vimRuntime}`,
    "-c",
    `call writefile([json_encode(markdown_viewer#health#report())], "${out}")`,
    "-c",
    "q",
  ]);
  if (!result.ok) return failure(`vim: ${result.error}`);
  try {
    return JSON.parse(readFileSync(out, "utf8")) as Entry[];
  } catch {
    return failure("vim wrote no health JSON");
  }
};

const expectOrder = (editor: string, report: readonly Entry[]) => {
  const keys = report.map((entry) => entry.key);
  if (keys.join(",") !== cases.healthFieldOrder.join(",")) {
    failure(`${editor} field order ${keys.join(",")} differs from the shared order`);
  }
  for (const entry of report) {
    const failed = entry.value === "missing" || entry.value === "unknown";
    if (failed && (entry.fix === null || entry.fix === "")) {
      failure(`${editor} field ${entry.key} fails without a fix`);
    }
  }
};

let ran = 0;

if (selected().includes("nvim") && spawnSync("nvim", ["--version"]).status !== 0) {
  console.log("SKIP editor:health nvim (no nvim binary)");
} else if (selected().includes("nvim")) {
  expectOrder("nvim", nvimReport());
  ran += 1;
}

if (selected().includes("vim") && spawnSync("vim", ["--version"]).status !== 0) {
  console.log("SKIP editor:health vim (no vim binary)");
} else if (selected().includes("vim")) {
  expectOrder("vim", vimReport());
  ran += 1;
}

if (ran === 0) {
  console.log("SKIP editor:health: no selected editor binary on PATH");
  process.exit(0);
}

console.log(
  `OK editor:health (${selected().join(", ")}${process.argv.includes("--no-server") ? ", no server" : ""})`,
);
