import { Result, SchemaAST } from "effect";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  EDITOR_PROTOCOL_VERSION,
  EditorMessageSchema,
  decodeEditorMessage,
  encodeEditorMessage,
  type EditorMessage,
} from "./editor-protocol.ts";
import { PROTOCOL_VERSION, decodeServerMessage, encodeServerMessage } from "./protocol.ts";
import { additiveViolations } from "./protocol-baseline.ts";

const casesPath = fileURLToPath(
  new URL("../../../fixtures/generated/editor-frames/cases.json", import.meta.url),
);

type ManifestCase = {
  readonly tag: string;
  readonly message: EditorMessage;
};

type Manifest = {
  readonly editorProtocolVersion: number;
  readonly tags: readonly string[];
  readonly fields: Readonly<Record<string, readonly string[]>>;
  readonly optionalFields: Readonly<Record<string, readonly string[]>>;
  readonly stages: readonly string[];
  readonly cases: readonly ManifestCase[];
};

const manifest = (): Manifest => JSON.parse(readFileSync(casesPath, "utf8")) as Manifest;

const decode = (text: string): EditorMessage => {
  const result = decodeEditorMessage(text);
  if (Result.isFailure(result)) throw new Error(result.failure.message);
  return result.success;
};

const documentFixture: EditorMessage = {
  _tag: "document",
  editorProtocolVersion: EDITOR_PROTOCOL_VERSION,
  path: "",
  text: "# Empty path\n",
};

const fixtures: Readonly<Record<string, EditorMessage>> = {
  document: documentFixture,
  ready: {
    _tag: "ready",
    editorProtocolVersion: EDITOR_PROTOCOL_VERSION,
    sessionId: "0f8fad5b-d9cb-469f-a165-70867728950e",
    url: "http://127.0.0.1:4321/",
  },
  error: {
    _tag: "error",
    editorProtocolVersion: EDITOR_PROTOCOL_VERSION,
    stage: "protocol",
    message: "invalid editor frame",
  },
  configuration: {
    _tag: "configuration",
    editorProtocolVersion: EDITOR_PROTOCOL_VERSION,
    values: [
      { key: "preview.width", source: "setup:preview.width", value: "900px" },
      { key: "preview.auto_start", source: "g:mkdp_auto_start", value: true },
    ],
  },
  cursor: {
    _tag: "cursor",
    editorProtocolVersion: EDITOR_PROTOCOL_VERSION,
    line: 12,
    fraction: 0.25,
  },
};

/** The pinned baseline: a rename, a retype, a reorder, or a removal fails. */
const pinned = {
  version: 1,
  tags: ["document", "ready", "error"],
  fields: {
    document: ["_tag", "editorProtocolVersion", "path", "text"],
    ready: ["_tag", "editorProtocolVersion", "sessionId", "url"],
    error: ["_tag", "editorProtocolVersion", "stage", "message", "clientVersion", "serverVersion"],
  },
  optionalFields: {
    document: [],
    ready: [],
    error: ["clientVersion", "serverVersion"],
  },
  stages: ["bind", "protocol", "render", "client"],
} as const;

/** Every schema addition must be listed here in the same commit, at version 1. */
const ADDITIVE = {
  tags: ["configuration", "cursor"],
  fields: {
    configuration: ["_tag", "editorProtocolVersion", "values"],
    cursor: ["_tag", "editorProtocolVersion", "line", "fraction"],
  },
  optionalFields: {
    configuration: [],
    cursor: [],
  },
  stages: ["config"],
} as const;

type MessageShape = {
  readonly tag: string;
  readonly fields: readonly string[];
  readonly optionalFields: readonly string[];
};

const literalValue = (ast: SchemaAST.AST): unknown => {
  if (!SchemaAST.isLiteral(ast)) throw new Error("expected a literal AST");
  return ast.literal;
};

const shapes = (): readonly MessageShape[] => {
  const ast = EditorMessageSchema.ast;
  if (!SchemaAST.isUnion(ast)) throw new Error("expected a union schema");

  return ast.types.map((member) => {
    if (!SchemaAST.isObjects(member)) throw new Error("expected an object member");
    const tagProperty = member.propertySignatures.find((property) => property.name === "_tag");
    if (tagProperty === undefined) throw new Error("message member has no _tag");

    return {
      tag: String(literalValue(tagProperty.type)),
      fields: member.propertySignatures.map((property) => String(property.name)),
      optionalFields: member.propertySignatures
        .filter((property) => property.type.context?.isOptional === true)
        .map((property) => String(property.name)),
    };
  });
};

const withVersion = (message: EditorMessage, version: number): string => {
  const payload = JSON.parse(encodeEditorMessage(message)) as Record<string, unknown>;
  payload.editorProtocolVersion = version;
  return JSON.stringify(payload);
};

const stageValues = (): readonly string[] => {
  for (const shape of shapes()) {
    if (shape.tag !== "error") continue;
    const ast = EditorMessageSchema.ast;
    if (!SchemaAST.isUnion(ast)) continue;
    for (const member of ast.types) {
      if (!SchemaAST.isObjects(member)) continue;
      const stage = member.propertySignatures.find((property) => property.name === "stage");
      if (stage === undefined || !SchemaAST.isUnion(stage.type)) continue;
      return stage.type.types.map((lit) => String(literalValue(lit)));
    }
  }
  return [];
};

describe("editor protocol", () => {
  it("round-trips every message in the set, including an empty path", () => {
    for (const [name, message] of Object.entries(fixtures)) {
      expect(decode(encodeEditorMessage(message)), name).toEqual(message);
    }

    const document = decode(encodeEditorMessage(documentFixture));
    expect(document._tag === "document" ? document.path : null).toBe("");
    expect(Object.keys(fixtures)).toHaveLength(5);
    expect(new Set(Object.values(fixtures).map((message) => message._tag)).size).toBe(5);
  });

  it("reports both versions when the payload version differs", () => {
    const result = decodeEditorMessage(withVersion(documentFixture, EDITOR_PROTOCOL_VERSION + 1));

    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure.reason).toBe("version");
      expect(result.failure.message).toContain(String(EDITOR_PROTOCOL_VERSION + 1));
      expect(result.failure.message).toContain(String(EDITOR_PROTOCOL_VERSION));
      expect(result.failure.clientVersion).toBe(EDITOR_PROTOCOL_VERSION + 1);
      expect(result.failure.serverVersion).toBe(EDITOR_PROTOCOL_VERSION);
    }
  });

  it("rejects an unknown tag, and a document frame without text", () => {
    const unknownTag = decodeEditorMessage(
      `{"_tag":"nope","editorProtocolVersion":${EDITOR_PROTOCOL_VERSION}}`,
    );
    const missingText = decodeEditorMessage(
      `{"_tag":"document","editorProtocolVersion":${EDITOR_PROTOCOL_VERSION},"path":""}`,
    );

    expect(Result.isFailure(unknownTag)).toBe(true);
    expect(Result.isFailure(missingText)).toBe(true);
  });

  it("keeps editorProtocolVersion and the page's protocolVersion apart", () => {
    const pageReady = encodeServerMessage({
      _tag: "ready",
      protocolVersion: PROTOCOL_VERSION,
      title: null,
      fileName: "a.md",
    });
    const editorReady = encodeEditorMessage(fixtures.ready!);

    expect(Result.isFailure(decodeEditorMessage(pageReady))).toBe(true);
    expect(Result.isFailure(decodeServerMessage(editorReady))).toBe(true);
  });

  it("pins the tag, field, and version table against a regenerate", () => {
    const committed = manifest();
    const schemaShapes = shapes();

    expect(EDITOR_PROTOCOL_VERSION).toBe(pinned.version);
    expect(committed.editorProtocolVersion).toBe(pinned.version);
    expect(additiveViolations(pinned, ADDITIVE, schemaShapes, stageValues())).toEqual([]);
    expect(additiveViolations(pinned, ADDITIVE, schemaShapes, committed.stages)).toEqual([]);

    const expectedTags = new Set([...pinned.tags, ...ADDITIVE.tags]);
    expect(new Set(committed.tags)).toEqual(expectedTags);
    expect(new Set(schemaShapes.map((shape) => shape.tag))).toEqual(expectedTags);
    expect(new Set(committed.cases.map((entry) => entry.tag))).toEqual(expectedTags);

    for (const shape of schemaShapes) {
      const expected = (pinned.tags as readonly string[]).includes(shape.tag)
        ? pinned.fields[shape.tag as keyof typeof pinned.fields]
        : ADDITIVE.fields[shape.tag as keyof typeof ADDITIVE.fields];
      expect(shape.fields, shape.tag).toEqual(expected);
      expect(committed.fields[shape.tag], shape.tag).toEqual(expected);
    }
  });

  it("fails a breaking baseline edit and an unlisted additive field", () => {
    const schemaShapes = shapes();

    const renamed = structuredClone(ADDITIVE) as unknown as {
      tags: string[];
      fields: Record<string, string[]>;
      optionalFields: Record<string, string[]>;
      stages: string[];
    };
    renamed.fields.cursor = ["_tag", "editorProtocolVersion", "cursorLine", "fraction"];
    expect(additiveViolations(pinned, renamed, schemaShapes, stageValues())).toHaveLength(1);

    const baseline = structuredClone(pinned) as unknown as {
      version: number;
      tags: string[];
      fields: Record<string, string[]>;
      optionalFields: Record<string, string[]>;
      stages: string[];
    };
    baseline.fields.document = ["_tag", "editorProtocolVersion", "content", "text"];
    expect(additiveViolations(baseline, ADDITIVE, schemaShapes, stageValues())).toHaveLength(1);
  });

  it("accepts each closed stage value and rejects an unknown one", () => {
    const stages = ["bind", "protocol", "render", "client", "config"];

    for (const stage of stages) {
      const message = decode(
        encodeEditorMessage({
          _tag: "error",
          editorProtocolVersion: EDITOR_PROTOCOL_VERSION,
          stage: stage as "bind" | "protocol" | "render" | "client" | "config",
          message: stage,
        }),
      );
      expect(message._tag === "error" ? message.stage : null).toBe(stage);
    }

    const unknown = decodeEditorMessage(
      `{"_tag":"error","editorProtocolVersion":${EDITOR_PROTOCOL_VERSION},"stage":"nope","message":"x"}`,
    );
    expect(Result.isFailure(unknown)).toBe(true);
  });
});
