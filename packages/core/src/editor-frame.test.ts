import { Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";

import {
  FRAME_TERMINATOR,
  MAX_FRAME_BYTES,
  createFrameDecoder,
  encodeFrame,
  type FrameDecoder,
  type FrameRead,
} from "./editor-frame.ts";
import {
  EDITOR_PROTOCOL_VERSION,
  encodeEditorMessage,
  type EditorMessage,
} from "./editor-protocol.ts";

const documentMessage = (text: string): EditorMessage => ({
  _tag: "document",
  editorProtocolVersion: EDITOR_PROTOCOL_VERSION,
  path: "fixtures/kitchen-sink.md",
  text,
});

const messages = (reads: ReadonlyArray<FrameRead>): readonly EditorMessage[] =>
  reads.flatMap((read) => (read._tag === "message" ? [read.value] : []));

const drain = (decoder: FrameDecoder, chunks: readonly Uint8Array[]): readonly FrameRead[] =>
  chunks.flatMap((chunk) => [...decoder.push(chunk)]);

describe("editor frame", () => {
  it("writes one compact JSON line and one terminator", () => {
    const message = documentMessage("a".repeat(1_300));
    const frame = encodeFrame(message);
    const body = frame.subarray(0, frame.length - 1);

    expect(frame[frame.length - 1]).toBe(FRAME_TERMINATOR);
    expect(Buffer.from(body).toString("utf8")).toBe(encodeEditorMessage(message));
    expect(Buffer.from(body).includes(FRAME_TERMINATOR)).toBe(false);
  });

  it("decodes one frame from one chunk, two frames from one chunk, and a frame split at every offset", () => {
    const first = documentMessage("# first\n");
    const second = documentMessage("# second\n");
    const firstFrame = encodeFrame(first);
    const secondFrame = encodeFrame(second);

    expect(messages(drain(createFrameDecoder(), [firstFrame]))).toEqual([first]);

    expect(
      messages(drain(createFrameDecoder(), [Buffer.concat([firstFrame, secondFrame])])),
    ).toEqual([first, second]);

    for (let offset = 0; offset <= firstFrame.length; offset += 1) {
      const decoder = createFrameDecoder();
      const before = [...decoder.push(firstFrame.subarray(0, offset))];
      const after = drain(decoder, [firstFrame.subarray(offset)]);
      expect(
        [...before, ...after].map((read) => read._tag),
        `offset ${offset}`,
      ).toEqual(["message"]);
      expect(messages([...before, ...after])).toEqual([first]);
    }
  });

  it("answers an invalid read, never a throw, for a payload that is not JSON", () => {
    const decoder = createFrameDecoder();
    const valid = documentMessage("# after the bad line\n");

    const reads = drain(decoder, [Buffer.from("not json\n", "utf8"), encodeFrame(valid)]);

    expect(reads[0]?._tag).toBe("invalid");
    expect(reads[0]?._tag === "invalid" ? reads[0].fault : null).toBe("protocol");
    expect(messages(reads)).toEqual([valid]);
  });

  it("answers a fatal read above the cap and drops the buffer", () => {
    const decoder = createFrameDecoder();
    const oversized = new Uint8Array(MAX_FRAME_BYTES + 1);
    const half = Math.floor(oversized.length / 2);

    const reads = drain(decoder, [oversized.subarray(0, half), oversized.subarray(half)]);

    expect(reads).toHaveLength(1);
    expect(reads[0]?._tag).toBe("fatal");
    expect(reads[0]?._tag === "fatal" ? reads[0].fault : null).toBe("cap");
    expect(reads[0]?._tag === "fatal" ? reads[0].detail : "").toContain(String(MAX_FRAME_BYTES));

    const recovered = documentMessage("# after the cap\n");
    expect(messages(drain(decoder, [encodeFrame(recovered)]))).toEqual([recovered]);
  });

  it("round-trips text that is not ASCII-safe", () => {
    const text = "nul:\u0000 high:\u00e9\u2014 newline:\n tab:\t bel:\u0007";
    const message = documentMessage(text);
    const frame = encodeFrame(message);

    for (let offset = 0; offset <= frame.length; offset += 1) {
      const decoder = createFrameDecoder();
      const reads = drain(decoder, [frame.subarray(0, offset), frame.subarray(offset)]);
      const [decoded] = messages(reads);
      expect(decoded?._tag === "document" ? decoded.text : null, `offset ${offset}`).toBe(text);
    }
  });
});
