/**
 * A second adapter written only from `docs/editor-protocol.md`.
 *
 * It imports the frame encoder and nothing else from the repository, and it
 * imports no schema. Every field it sends is stated in the document.
 */
import { encodeFrame } from "@mdv/core/editor-frame";

export const CONFIGURATION_VALUE = "48rem";
export const DOCUMENT_PATH = "/tmp/mdv-protocol-adapter.md";
export const DOCUMENT_TEXT = "# Adapter\n\nParagraph one.\n\nParagraph two.\n";
export const CURSOR_LINE = 3;
export const CURSOR_FRACTION = 0.25;

/** The start order: configuration, then the document. */
export const startFrames = (): readonly Uint8Array[] => [
  encodeFrame({
    _tag: "configuration",
    editorProtocolVersion: 1,
    values: [{ key: "preview.width", value: CONFIGURATION_VALUE, source: "setup:preview.width" }],
  }),
  encodeFrame({
    _tag: "document",
    editorProtocolVersion: 1,
    path: DOCUMENT_PATH,
    text: DOCUMENT_TEXT,
  }),
];

/** One cursor frame: the document's last line plus the in-window fraction. */
export const cursorFrame = (): Uint8Array =>
  encodeFrame({
    _tag: "cursor",
    editorProtocolVersion: 1,
    line: CURSOR_LINE,
    fraction: CURSOR_FRACTION,
  });

/** An invalid value, taken from the document's rejected-value example. */
export const rejectedFrame = (): Uint8Array =>
  encodeFrame({
    _tag: "configuration",
    editorProtocolVersion: 1,
    values: [{ key: "preview.width", value: 42, source: "setup:preview.width" }],
  });

/** The page handshake, from `docs/protocol.md`: `hello` then `ack`. */
export const hello = (): string => JSON.stringify({ _tag: "hello", protocolVersion: 1 });
export const ack = (): string => JSON.stringify({ _tag: "ack" });
