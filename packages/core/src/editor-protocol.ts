// @effect-diagnostics schemaNumber:off
// @effect-diagnostics schemaStructWithTag:off
import { Result, Schema } from "effect";

/**
 * The editor wire has its own version, beside the page's `PROTOCOL_VERSION`,
 * which stays `1` because no page message changed. The field name differs, so
 * no frame can be read as the other transport's version.
 */
export const EDITOR_PROTOCOL_VERSION = 1;

const DocumentSchema = Schema.Struct({
  _tag: Schema.Literal("document"),
  // First field by convention: the decoder reads it before applying the union.
  editorProtocolVersion: Schema.Number,
  // May be empty. Unsaved buffers later need no wire change and no version bump.
  path: Schema.String,
  text: Schema.String,
});

const ReadySchema = Schema.Struct({
  _tag: Schema.Literal("ready"),
  editorProtocolVersion: Schema.Number,
  // Opaque. PT-5's token attaches to `url`, so neither value may be parsed.
  sessionId: Schema.String,
  url: Schema.String,
});

const ErrorSchema = Schema.Struct({
  _tag: Schema.Literal("error"),
  editorProtocolVersion: Schema.Number,
  // Closed set. `client` reports a failed client build through the same path.
  stage: Schema.Literals(["bind", "protocol", "render", "client"]),
  message: Schema.String,
  // Present on a version mismatch only.
  clientVersion: Schema.optionalKey(Schema.Number),
  serverVersion: Schema.optionalKey(Schema.Number),
});

/** The whole editor message set: three tags, and no `end`. */
export const EditorMessageSchema = Schema.Union([DocumentSchema, ReadySchema, ErrorSchema]);

export type EditorMessage = Schema.Schema.Type<typeof EditorMessageSchema>;
export type DocumentMessage = Schema.Schema.Type<typeof DocumentSchema>;
export type ReadyMessage = Schema.Schema.Type<typeof ReadySchema>;
export type ErrorMessage = Schema.Schema.Type<typeof ErrorSchema>;
export type ServerToEditorMessage = ReadyMessage | ErrorMessage;

/** A version difference is reported as a value, never as a schema failure. */
export class EditorProtocolError extends Schema.TaggedError<
  EditorProtocolError,
  { readonly brand: unique symbol }
>()("EditorProtocolError", {
  reason: Schema.Literals(["version", "decode"]),
  message: Schema.String,
  clientVersion: Schema.optionalKey(Schema.Number),
  serverVersion: Schema.optionalKey(Schema.Number),
}) {}

const editorMessageJson = Schema.fromJsonString(EditorMessageSchema);
const jsonPayload = Schema.fromJsonString(Schema.Unknown);

export const encodeEditorMessage = Schema.encodeSync(editorMessageJson);

const decodeJson = Schema.decodeUnknownResult(jsonPayload);
const decodeUnion = Schema.decodeUnknownResult(EditorMessageSchema);

const versionOf = (payload: unknown): unknown =>
  typeof payload === "object" && payload !== null && "editorProtocolVersion" in payload
    ? (payload as { readonly editorProtocolVersion: unknown }).editorProtocolVersion
    : undefined;

const versionText = (version: unknown): string =>
  typeof version === "number" || typeof version === "string" ? String(version) : "missing";

/**
 * Parse JSON, read the version, compare it, then apply the union. A version
 * difference therefore never arrives as a schema failure (PT-9).
 */
export const decodeEditorMessage = (
  text: string,
): Result.Result<EditorMessage, EditorProtocolError> => {
  const parsed = decodeJson(text);

  if (Result.isFailure(parsed)) {
    return Result.fail(
      new EditorProtocolError({
        reason: "decode",
        message: "invalid editor frame: the payload is not JSON",
      }),
    );
  }

  const payload = parsed.success;
  const version = versionOf(payload);

  if (version !== EDITOR_PROTOCOL_VERSION) {
    return Result.fail(
      new EditorProtocolError({
        reason: "version",
        message: `editor protocol version mismatch: client ${versionText(version)}, server ${EDITOR_PROTOCOL_VERSION}`,
        ...(typeof version === "number" ? { clientVersion: version } : {}),
        serverVersion: EDITOR_PROTOCOL_VERSION,
      }),
    );
  }

  const decoded = decodeUnion(payload);

  if (Result.isFailure(decoded)) {
    return Result.fail(
      new EditorProtocolError({
        reason: "decode",
        message: "invalid editor frame: the payload does not match the message set",
      }),
    );
  }

  return Result.succeed(decoded.success);
};
