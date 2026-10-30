#!/usr/bin/env bun
/**
 * Write the configuration key tables for Neovim and Vim.
 *
 * The render lives in `packages/editor/src/render-config.ts`; this entrypoint
 * only writes it. No guard is needed, because nothing imports this file.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { renderConfig } from "../packages/editor/src/render-config.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageRoot = path.join(root, "packages/editor");
const rendered = renderConfig();

for (const table of [rendered.nvim, rendered.vim]) {
  const target = path.join(packageRoot, table.file);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, table.source);
}

console.log(`wrote ${rendered.rows.length} configuration keys for both languages`);
