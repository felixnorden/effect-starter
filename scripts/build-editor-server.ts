#!/usr/bin/env bun
/**
 * Builds the editor server into the plugin's gitignored bin directory:
 *
 *   packages/editor/bin/mdv-<os>-<arch>
 *   packages/editor/bin/client/
 *
 * The client is built with Vite only when it is missing. The server is a
 * compiled Bun binary, so a plugin install needs no Bun at runtime.
 */
import { chmodSync, cpSync, existsSync, mkdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const binDir = path.join(root, "packages/editor/bin");
const clientSource = path.join(root, "packages/app/dist/client");
const entry = path.join(root, "packages/app/src/main.ts");

const os =
  process.platform === "darwin" ? "darwin" : process.platform === "win32" ? "win32" : "linux";
const arch = process.arch === "arm64" ? "arm64" : "x64";
const name = `mdv-${os}-${arch}${os === "win32" ? ".exe" : ""}`;
const outfile = path.join(binDir, name);

const run = (cmd: readonly string[], label: string): void => {
  const result = Bun.spawnSync({
    cmd,
    cwd: root,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  if (result.exitCode !== 0) {
    throw new Error(`${label} exited ${result.exitCode}`);
  }
};

const sizeOf = (file: string): string => `${(statSync(file).size / 1024 / 1024).toFixed(1)} MB`;

if (!existsSync(path.join(root, "node_modules"))) {
  console.error("Run bun install first.");
  process.exit(1);
}

if (!existsSync(path.join(clientSource, "index.html"))) {
  console.log("building client…");
  run(["bun", "run", "build"], "client build");
}

if (!existsSync(path.join(clientSource, "index.html"))) {
  console.error(`client build is missing ${path.join(clientSource, "index.html")}`);
  process.exit(1);
}

mkdirSync(binDir, { recursive: true });
console.log(`compiling ${name}…`);
run(
  ["bun", "build", "--compile", "--minify", "--external", "vite", entry, "--outfile", outfile],
  "server compile",
);
chmodSync(outfile, 0o755);

const clientDest = path.join(binDir, "client");
rmSync(clientDest, { recursive: true, force: true });
cpSync(clientSource, clientDest, { recursive: true });

console.log(`server: ${path.relative(root, outfile)} (${sizeOf(outfile)})`);
console.log(`client: ${path.relative(root, clientDest)}`);
