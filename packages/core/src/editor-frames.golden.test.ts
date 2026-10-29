import { SchemaAST } from "effect";
import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { MAX_FRAME_BYTES, encodeFrame } from "./editor-frame.ts";
import {
  EDITOR_PROTOCOL_VERSION,
  EditorMessageSchema,
  type EditorMessage,
} from "./editor-protocol.ts";

const framesDir = fileURLToPath(
  new URL("../../../fixtures/generated/editor-frames/", import.meta.url),
);
const nvimGenerated = fileURLToPath(
  new URL("../../../packages/editor/nvim/lua/markdown_viewer/generated/", import.meta.url),
);
const vimGenerated = fileURLToPath(
  new URL("../../../packages/editor/vim/autoload/markdown_viewer/generated/", import.meta.url),
);

type GoldenCase = {
  readonly name: string;
  readonly file: string;
  readonly tag: string;
  readonly message: EditorMessage;
};

type GoldenManifest = {
  readonly editorProtocolVersion: number;
  readonly maxFrameBytes: number;
  readonly frameTerminator: number;
  readonly tags: readonly string[];
  readonly stages: readonly string[];
  readonly fields: Readonly<Record<string, readonly string[]>>;
  readonly optionalFields: Readonly<Record<string, readonly string[]>>;
  readonly cases: readonly GoldenCase[];
};

const manifest = JSON.parse(readFileSync(`${framesDir}cases.json`, "utf8")) as GoldenManifest;

const literalValue = (ast: SchemaAST.AST): unknown => {
  if (!SchemaAST.isLiteral(ast)) throw new Error("expected a literal AST");
  return ast.literal;
};

const tagsOfSchema = (): readonly string[] => {
  const ast = EditorMessageSchema.ast;
  if (!SchemaAST.isUnion(ast)) throw new Error("expected a union schema");
  return ast.types.map((member) => {
    if (!SchemaAST.isObjects(member)) throw new Error("expected an object member");
    const tag = member.propertySignatures.find((property) => property.name === "_tag");
    if (tag === undefined) throw new Error("message member has no _tag");
    return String(literalValue(tag.type));
  });
};

const generatedText = (): readonly { readonly language: string; readonly text: string }[] => [
  {
    language: "lua",
    text: `${readFileSync(`${nvimGenerated}wire.lua`, "utf8")}${readFileSync(`${nvimGenerated}codec.lua`, "utf8")}`,
  },
  {
    language: "vim",
    text: `${readFileSync(`${vimGenerated}wire.vim`, "utf8")}${readFileSync(`${vimGenerated}codec.vim`, "utf8")}`,
  },
];

const quoted = (value: string): readonly string[] => [`"${value}"`, `'${value}'`];

describe("editor golden frames", () => {
  it("encodes every committed case byte-for-byte", () => {
    expect(manifest.editorProtocolVersion).toBe(EDITOR_PROTOCOL_VERSION);
    expect(manifest.maxFrameBytes).toBe(MAX_FRAME_BYTES);

    for (const entry of manifest.cases) {
      const committed = readFileSync(`${framesDir}${entry.file}`);
      const encoded = Buffer.from(encodeFrame(entry.message));

      expect(encoded.equals(committed), entry.name).toBe(true);
    }
  });

  it("names every schema tag in the manifest", () => {
    expect(new Set(manifest.tags)).toEqual(new Set(tagsOfSchema()));
    expect(new Set(manifest.cases.map((entry) => entry.tag))).toEqual(new Set(tagsOfSchema()));
  });

  it("carries the version, the cap, and every tag and field name in both generated codecs", () => {
    const fields = Object.values(manifest.fields).flat();

    for (const generated of generatedText()) {
      expect(generated.text, generated.language).toContain(String(EDITOR_PROTOCOL_VERSION));
      expect(generated.text, generated.language).toContain(String(MAX_FRAME_BYTES));

      for (const tag of manifest.tags) {
        expect(
          quoted(tag).some((literal) => generated.text.includes(literal)),
          `${generated.language} tag ${tag}`,
        ).toBe(true);
      }

      for (const field of fields) {
        expect(
          quoted(field).some((literal) => generated.text.includes(literal)),
          `${generated.language} field ${field}`,
        ).toBe(true);
      }

      for (const stage of manifest.stages) {
        expect(
          quoted(stage).some((literal) => generated.text.includes(literal)),
          `${generated.language} stage ${stage}`,
        ).toBe(true);
      }
    }
  });
});
