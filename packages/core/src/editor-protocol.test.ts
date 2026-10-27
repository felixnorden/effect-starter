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
};

/** One hand-written table: a schema edit fails here even after a regenerate. */
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

describe("editor protocol", () => {
  it("round-trips every message in the set, including an empty path", () => {
    for (const [name, message] of Object.entries(fixtures)) {
      expect(decode(encodeEditorMessage(message)), name).toEqual(message);
    }

    const document = decode(encodeEditorMessage(documentFixture));
    expect(document._tag === "document" ? document.path : null).toBe("");
    expect(Object.keys(fixtures)).toHaveLength(3);
    expect(new Set(Object.values(fixtures).map((message) => message._tag)).size).toBe(3);
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

    expect(EDITOR_PROTOCOL_VERSION).toBe(pinned.version);
    expect(committed.editorProtocolVersion).toBe(pinned.version);
    expect(new Set(committed.tags)).toEqual(new Set(pinned.tags));
    expect(new Set(committed.stages)).toEqual(new Set(pinned.stages));

    const schemaShapes = shapes();
    expect(new Set(schemaShapes.map((shape) => shape.tag))).toEqual(new Set(pinned.tags));

    for (const shape of schemaShapes) {
      expect(shape.fields, shape.tag).toEqual(
        pinned.fields[shape.tag as keyof typeof pinned.fields],
      );
      expect(shape.optionalFields, shape.tag).toEqual(
        pinned.optionalFields[shape.tag as keyof typeof pinned.optionalFields],
      );
      expect(committed.fields[shape.tag], shape.tag).toEqual(
        pinned.fields[shape.tag as keyof typeof pinned.fields],
      );
      expect(committed.optionalFields[shape.tag], shape.tag).toEqual(
        pinned.optionalFields[shape.tag as keyof typeof pinned.optionalFields],
      );
    }

    expect(new Set(committed.cases.map((entry) => entry.tag))).toEqual(new Set(pinned.tags));
  });

  it("accepts each closed stage value and rejects an unknown one", () => {
    const stages = ["bind", "protocol", "render", "client"];

    for (const stage of stages) {
      const message = decode(
        encodeEditorMessage({
          _tag: "error",
          editorProtocolVersion: EDITOR_PROTOCOL_VERSION,
          stage: stage as "bind" | "protocol" | "render" | "client",
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
