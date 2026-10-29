#!/usr/bin/env bun
/**
 * PF-7's reproducible CSS split: the built stylesheet, the framework layer on
 * its own, and the three parts the framework entry does not own. Deliberately
 * outside `check`: it builds twice and then fails loudly rather than guessing.
 *
 * Usage: `bun scripts/measure-css.ts`
 */
import { createRequire } from "node:module";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import tailwindcss from "@tailwindcss/vite";
import { build } from "vite";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const appDir = path.join(root, "packages/app");
const clientDir = path.join(appDir, "src/client");
const appRequire = createRequire(path.join(appDir, "package.json"));

/** KaTeX ships from the app package; the fallback keeps a hoisted install working. */
const katexStylesheet = (): string => {
  try {
    return appRequire.resolve("katex/dist/katex.min.css");
  } catch {
    return path.join(appDir, "node_modules/katex/dist/katex.min.css");
  }
};

type Size = { readonly raw: number; readonly gzip: number };

const kb = (bytes: number): string => (bytes / 1024).toFixed(2);

const sizeOf = (files: readonly string[]): Size => {
  const bytes = Buffer.concat(files.map((file) => readFileSync(file)));
  return { raw: bytes.length, gzip: gzipSync(bytes).length };
};

const sizeOfDir = (dir: string): Size => {
  const files = readdirSync(dir)
    .filter((file) => file.endsWith(".css"))
    .map((file) => path.join(dir, file));
  return sizeOf(files);
};

/** Exactly one stylesheet, or the measurement is not the split we claim. */
const cssAssets = (distDir: string): readonly string[] => {
  const files = readdirSync(path.join(distDir, "assets")).filter((file) => file.endsWith(".css"));
  if (files.length !== 1) {
    throw new Error(`${distDir} emitted ${files.length} CSS assets: ${files.join(", ")}`);
  }
  return files.map((file) => path.join(distDir, "assets", file));
};

// 1. The app's real build, with its real config.
await build({ configFile: path.join(appDir, "vite.config.ts"), logLevel: "silent" });
const appCss = cssAssets(path.join(appDir, "dist/client"));
const total = sizeOf(appCss);

// 2. A second build whose entry imports only the framework entry.
const tempDir = mkdtempSync(path.join(appDir, ".measure-css-"));
let framework: Size;
try {
  writeFileSync(
    path.join(tempDir, "index.html"),
    '<!doctype html><html><head></head><body><script type="module" src="./entry.ts"></script></body></html>\n',
  );
  writeFileSync(
    path.join(tempDir, "entry.ts"),
    `import ${JSON.stringify(path.join(clientDir, "daisyui.css"))};\n`,
  );
  mkdirSync(path.join(tempDir, "dist"), { recursive: true });
  await build({
    configFile: false,
    root: tempDir,
    logLevel: "silent",
    plugins: [tailwindcss()],
    build: { outDir: path.join(tempDir, "dist"), emptyOutDir: true },
  });
  framework = sizeOf(cssAssets(path.join(tempDir, "dist")));
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}

// 3. The three parts the framework entry does not own.
const styles = sizeOf([path.join(clientDir, "styles.css")]);
const katex = sizeOf([katexStylesheet()]);
const sheets = sizeOfDir(path.join(clientDir, "public/theme-sheets"));

if ([styles, katex, sheets, framework].some((part) => part.raw === 0)) {
  throw new Error("a CSS part measured zero bytes");
}
if (framework.raw > total.raw) {
  throw new Error(`framework build (${framework.raw} B) exceeds the app total (${total.raw} B)`);
}

const rows: ReadonlyArray<readonly [string, Size]> = [
  ["framework layer (tailwind + daisyUI)", framework],
  ["app stylesheet", styles],
  ["KaTeX stylesheet", katex],
  [
    `theme sheets (${readdirSync(path.join(clientDir, "public/theme-sheets")).length} files)`,
    sheets,
  ],
  ["built app stylesheet (total)", total],
];

console.log("part                                    raw KB   gzip KB");
for (const [label, size] of rows) {
  console.log(`${label.padEnd(38)} ${kb(size.raw).padStart(8)} ${kb(size.gzip).padStart(9)}`);
}
