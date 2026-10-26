// @effect-diagnostics schemaNumber:off
// @effect-diagnostics schemaStructWithTag:off
import { Schema } from "effect";

import { BlockIdSchema, BlockKindSchema, LineRangeSchema } from "./model.ts";

export type { BlockId, BlockKind, LineRange } from "./model.ts";

/** One version, written before v1 ships. The golden frames pin it. */
export const PROTOCOL_VERSION = 1;

/**
 * A block on the wire. `hast` crosses as an unknown envelope field: the server
 * never re-validates a tree it just built, and the page guards it on arrival.
 */
export const WireBlockSchema = Schema.Struct({
  id: BlockIdSchema,
  hash: Schema.String,
  kind: BlockKindSchema,
  // Snapshot-scoped: a patch does not refresh unchanged ranges.
  range: LineRangeSchema,
  hast: Schema.Unknown,
});
export type WireBlock = Schema.Schema.Type<typeof WireBlockSchema>;

const ReadySchema = Schema.Struct({
  _tag: Schema.Literal("ready"),
  protocolVersion: Schema.Number,
  title: Schema.NullOr(Schema.String),
  // The display basename comes from the app, the only layer that sees a path.
  fileName: Schema.String,
});

const SnapshotSchema = Schema.Struct({
  _tag: Schema.Literal("snapshot"),
  seq: Schema.Number,
  title: Schema.NullOr(Schema.String),
  blocks: Schema.Array(WireBlockSchema),
});

const PatchSchema = Schema.Struct({
  _tag: Schema.Literal("patch"),
  seq: Schema.Number,
  title: Schema.NullOr(Schema.String),
  // Sent only when the id sequence changed: insert, delete, or reorder.
  order: Schema.optionalKey(Schema.Array(BlockIdSchema)),
  upserts: Schema.Array(WireBlockSchema),
  removed: Schema.Array(BlockIdSchema),
});

const ErrorSchema = Schema.Struct({
  _tag: Schema.Literal("error"),
  stage: Schema.String,
  message: Schema.String,
});

const HelloSchema = Schema.Struct({
  _tag: Schema.Literal("hello"),
  protocolVersion: Schema.Number,
});

const AckSchema = Schema.Struct({ _tag: Schema.Literal("ack") });

const RequestSnapshotSchema = Schema.Struct({ _tag: Schema.Literal("requestSnapshot") });

export const ServerMessageSchema = Schema.Union([
  ReadySchema,
  SnapshotSchema,
  PatchSchema,
  ErrorSchema,
]);

export const ClientMessageSchema = Schema.Union([HelloSchema, AckSchema, RequestSnapshotSchema]);

export type ServerMessage = Schema.Schema.Type<typeof ServerMessageSchema>;
export type ClientMessage = Schema.Schema.Type<typeof ClientMessageSchema>;
export type ReadyMessage = Schema.Schema.Type<typeof ReadySchema>;
export type SnapshotMessage = Schema.Schema.Type<typeof SnapshotSchema>;
export type PatchMessage = Schema.Schema.Type<typeof PatchSchema>;
export type ErrorMessage = Schema.Schema.Type<typeof ErrorSchema>;
export type DocumentUpdate = SnapshotMessage | PatchMessage;

const serverMessageJson = Schema.fromJsonString(ServerMessageSchema);
const clientMessageJson = Schema.fromJsonString(ClientMessageSchema);

export const encodeServerMessage = Schema.encodeSync(serverMessageJson);
export const decodeServerMessage = Schema.decodeUnknownResult(serverMessageJson);
export const encodeClientMessage = Schema.encodeSync(clientMessageJson);
export const decodeClientMessage = Schema.decodeUnknownResult(clientMessageJson);
