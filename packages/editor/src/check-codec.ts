/**
 * Compare every committed generated file with what the schema renders.
 *
 * This runs first in `check:types`, so a stale generated codec names itself
 * before a type error in the check can obscure it. It writes nothing, imports
 * the package render, and never touches an editor.
 */
import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { render } from "./render-codecs.ts";

const packageRoot = fileURLToPath(new URL("../", import.meta.url));
const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
const rendered = render();

type Target = {
  readonly file: string;
  readonly expected: Uint8Array | string;
};

const bytesOf = (value: Uint8Array | string): Buffer =>
  typeof value === "string" ? Buffer.from(value, "utf8") : Buffer.from(value);

const targets: readonly Target[] = [
  ...rendered.frames.map((frame) => ({
    file: path.join(repositoryRoot, "fixtures/generated/editor-frames", frame.file),
    expected: frame.bytes,
  })),
  {
    file: path.join(repositoryRoot, "fixtures/generated/editor-frames/cases.json"),
    expected: rendered.manifest,
  },
  {
    file: path.join(packageRoot, "nvim/lua/markdown_viewer/generated/wire.lua"),
    expected: rendered.nvim.wire,
  },
  {
    file: path.join(packageRoot, "nvim/lua/markdown_viewer/generated/codec.lua"),
    expected: rendered.nvim.codec,
  },
  {
    file: path.join(packageRoot, "vim/autoload/markdown_viewer/generated/wire.vim"),
    expected: rendered.vim.wire,
  },
  {
    file: path.join(packageRoot, "vim/autoload/markdown_viewer/generated/codec.vim"),
    expected: rendered.vim.codec,
  },
];

const fail = (file: string, detail: string): never => {
  console.error(`FAIL editor codecs: ${path.relative(repositoryRoot, file)} ${detail}`);
  process.exit(1);
};

for (const target of targets) {
  let actual: Buffer;
  try {
    actual = readFileSync(target.file);
  } catch {
    actual = fail(target.file, "is missing; run bun run frames:generate");
  }
  if (!actual.equals(bytesOf(target.expected))) {
    fail(target.file, "differs from the schema render; run bun run frames:generate");
  }
}

console.log(`OK editor codecs (${rendered.frames.length} frames, 2 codecs)`);
