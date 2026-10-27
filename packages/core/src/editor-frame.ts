import { Result } from "effect";

import { decodeEditorMessage, encodeEditorMessage, type EditorMessage } from "./editor-protocol.ts";

/**
 * One compact JSON payload followed by one `0x0A`. Compact JSON never contains
 * a newline byte, so one line is one frame by construction.
 */
export const FRAME_TERMINATOR = 0x0a;

/** Bounds one accumulated line. Checked before the buffer grows. */
export const MAX_FRAME_BYTES = 64 * 1024 * 1024;

export type FrameRead =
  | { readonly _tag: "message"; readonly value: EditorMessage }
  | {
      readonly _tag: "invalid";
      readonly fault: string;
      readonly detail: string;
      readonly clientVersion?: number;
      readonly serverVersion?: number;
    }
  | { readonly _tag: "fatal"; readonly fault: "cap"; readonly detail: string };

export type FrameDecoder = {
  /** Zero or more reads per chunk. A fatal read empties the buffer. */
  readonly push: (chunk: Uint8Array) => ReadonlyArray<FrameRead>;
};

// The core package has no DOM lib; every target runtime provides these globals.
declare const TextEncoder: { new (): { encode: (input: string) => Uint8Array } };
declare const TextDecoder: {
  new (
    label?: string,
    options?: { readonly fatal?: boolean },
  ): {
    decode: (input: Uint8Array) => string;
  };
};

const encodeUtf8 = (text: string): Uint8Array => new TextEncoder().encode(text);

const decodeUtf8 = (bytes: Uint8Array): string | null => {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
};

/** Encode one message as one frame: compact JSON plus one terminator. */
export const encodeFrame = (message: EditorMessage): Uint8Array => {
  const body = encodeUtf8(encodeEditorMessage(message));
  const frame = new Uint8Array(body.length + 1);
  frame.set(body);
  frame[body.length] = FRAME_TERMINATOR;
  return frame;
};

const readOf = (line: Uint8Array): FrameRead => {
  const text = decodeUtf8(line);

  if (text === null) {
    return { _tag: "invalid", fault: "utf8", detail: "frame is not valid UTF-8" };
  }

  const decoded = decodeEditorMessage(text);

  if (Result.isFailure(decoded)) {
    const error = decoded.failure;
    return {
      _tag: "invalid",
      fault: error.reason === "version" ? "version" : "protocol",
      detail: error.message,
      ...(error.clientVersion === undefined ? {} : { clientVersion: error.clientVersion }),
      ...(error.serverVersion === undefined ? {} : { serverVersion: error.serverVersion }),
    };
  }

  return { _tag: "message", value: decoded.success };
};

/**
 * One reader owns where a frame starts and ends. Chunks may split a frame or
 * hold several; the accumulator is bounded by the cap.
 */
export const createFrameDecoder = (): FrameDecoder => {
  let buffer = new Uint8Array(1024);
  let length = 0;

  const ensureCapacity = (needed: number): void => {
    if (needed <= buffer.length) return;
    const next = new Uint8Array(Math.min(MAX_FRAME_BYTES, Math.max(needed, buffer.length * 2)));
    next.set(buffer.subarray(0, length));
    buffer = next;
  };

  const push = (chunk: Uint8Array): ReadonlyArray<FrameRead> => {
    const reads: FrameRead[] = [];

    for (let index = 0; index < chunk.length; index += 1) {
      const byte = chunk[index]!;

      if (byte === FRAME_TERMINATOR) {
        reads.push(readOf(buffer.subarray(0, length)));
        length = 0;
        continue;
      }

      if (length >= MAX_FRAME_BYTES) {
        length = 0;
        reads.push({
          _tag: "fatal",
          fault: "cap",
          detail: `editor frame exceeds the ${MAX_FRAME_BYTES}-byte cap`,
        });
        return reads;
      }

      ensureCapacity(length + 1);
      buffer[length] = byte;
      length += 1;
    }

    return reads;
  };

  return { push };
};
