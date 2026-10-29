#!/usr/bin/env bun
/**
 * Write the editor wire: one golden frame per case, the case manifest, and the
 * same codec for Neovim and Vim.
 *
 * The render lives in `packages/editor/src/render-codecs.ts`; this entrypoint
 * only writes it. No guard is needed, because nothing imports this file.
 */
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { render } from "../packages/editor/src/render-codecs.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const framesDir = path.join(root, "fixtures/generated/editor-frames");
const nvimGenerated = path.join(root, "packages/editor/nvim/lua/markdown_viewer/generated");
const vimGenerated = path.join(root, "packages/editor/vim/autoload/markdown_viewer/generated");

const rendered = render();

mkdirSync(framesDir, { recursive: true });
mkdirSync(nvimGenerated, { recursive: true });
mkdirSync(vimGenerated, { recursive: true });

for (const file of readdirSync(framesDir)) {
  if (file.endsWith(".frame")) rmSync(path.join(framesDir, file));
}

for (const frame of rendered.frames) {
  writeFileSync(path.join(framesDir, frame.file), frame.bytes);
}
writeFileSync(path.join(framesDir, "cases.json"), rendered.manifest);

writeFileSync(path.join(nvimGenerated, "wire.lua"), rendered.nvim.wire);
writeFileSync(path.join(nvimGenerated, "codec.lua"), rendered.nvim.codec);
writeFileSync(path.join(vimGenerated, "wire.vim"), rendered.vim.wire);
writeFileSync(path.join(vimGenerated, "codec.vim"), rendered.vim.codec);

console.log(`wrote ${rendered.frames.length} golden frames and the two generated codecs`);
