/**
 * Compare the committed configuration tables with what the declaration renders.
 *
 * This runs in `check:types` beside `check-codec.ts`, so a stale table names
 * itself before a type error can obscure it. It writes nothing and never
 * touches an editor.
 */
import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { renderConfig } from "./render-config.ts";

const packageRoot = fileURLToPath(new URL("../", import.meta.url));
const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
const rendered = renderConfig();

const targets = [
  {
    file: path.join(packageRoot, rendered.nvim.file),
    expected: rendered.nvim.source,
  },
  {
    file: path.join(packageRoot, rendered.vim.file),
    expected: rendered.vim.source,
  },
];

const fail = (file: string, detail: string): never => {
  console.error(`FAIL configuration tables: ${path.relative(repositoryRoot, file)} ${detail}`);
  process.exit(1);
};

for (const target of targets) {
  let actual: Buffer;
  try {
    actual = readFileSync(target.file);
  } catch {
    actual = fail(target.file, "is missing; run bun run config:generate");
  }
  if (!actual.equals(Buffer.from(target.expected, "utf8"))) {
    fail(target.file, "differs from the declaration render; run bun run config:generate");
  }
}

console.log(`OK configuration tables (${rendered.rows.length} keys, 2 languages)`);
