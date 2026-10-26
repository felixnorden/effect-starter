import { Result } from "effect";
import { describe, expect, it } from "vitest";

import {
  PROTOCOL_VERSION,
  decodeClientMessage,
  decodeServerMessage,
  encodeClientMessage,
  encodeServerMessage,
  type ClientMessage,
  type ServerMessage,
  type WireBlock,
} from "./protocol.ts";

const block: WireBlock = {
  id: "b1" as WireBlock["id"],
  hash: "0123456789abcdef",
  kind: "paragraph",
  range: { startLine: 1, endLine: 1 },
  hast: [{ type: "text", value: "hi" }],
};

const serverFixtures: Record<string, ServerMessage> = {
  ready: {
    _tag: "ready",
    protocolVersion: PROTOCOL_VERSION,
    title: "Kitchen Sink",
    fileName: "kitchen-sink.md",
  },
  snapshot: { _tag: "snapshot", seq: 1, title: "Kitchen Sink", blocks: [block] },
  patchWithOrder: {
    _tag: "patch",
    seq: 2,
    title: "Kitchen Sink",
    order: ["b1" as WireBlock["id"], "b2" as WireBlock["id"]],
    upserts: [block],
    removed: ["b3" as WireBlock["id"]],
  },
  patchWithoutOrder: {
    _tag: "patch",
    seq: 2,
    title: "Kitchen Sink",
    upserts: [block],
    removed: [],
  },
  error: { _tag: "error", stage: "protocol", message: "bad frame" },
};

const clientFixtures: Record<string, ClientMessage> = {
  hello: { _tag: "hello", protocolVersion: PROTOCOL_VERSION },
  ack: { _tag: "ack" },
  requestSnapshot: { _tag: "requestSnapshot" },
};

const GOLDEN = {
  ready: `{"_tag":"ready","protocolVersion":1,"title":"Kitchen Sink","fileName":"kitchen-sink.md"}`,
  snapshot: `{"_tag":"snapshot","seq":1,"title":"Kitchen Sink","blocks":[{"id":"b1","hash":"0123456789abcdef","kind":"paragraph","range":{"startLine":1,"endLine":1},"hast":[{"type":"text","value":"hi"}]}]}`,
  patchWithOrder: `{"_tag":"patch","seq":2,"title":"Kitchen Sink","order":["b1","b2"],"upserts":[{"id":"b1","hash":"0123456789abcdef","kind":"paragraph","range":{"startLine":1,"endLine":1},"hast":[{"type":"text","value":"hi"}]}],"removed":["b3"]}`,
  patchWithoutOrder: `{"_tag":"patch","seq":2,"title":"Kitchen Sink","upserts":[{"id":"b1","hash":"0123456789abcdef","kind":"paragraph","range":{"startLine":1,"endLine":1},"hast":[{"type":"text","value":"hi"}]}],"removed":[]}`,
  error: `{"_tag":"error","stage":"protocol","message":"bad frame"}`,
  hello: `{"_tag":"hello","protocolVersion":1}`,
  ack: `{"_tag":"ack"}`,
  requestSnapshot: `{"_tag":"requestSnapshot"}`,
} as const;

const decodeServer = (frame: string): ServerMessage => {
  const result = decodeServerMessage(frame);
  if (!Result.isSuccess(result)) throw new Error("expected a server message");
  return result.success;
};

const decodeClient = (frame: string): ClientMessage => {
  const result = decodeClientMessage(frame);
  if (!Result.isSuccess(result)) throw new Error("expected a client message");
  return result.success;
};

describe("protocol", () => {
  for (const [name, message] of Object.entries(serverFixtures)) {
    it(`round-trips ${name}`, () => {
      expect(decodeServer(encodeServerMessage(message))).toEqual(message);
    });
  }

  for (const [name, message] of Object.entries(clientFixtures)) {
    it(`round-trips ${name}`, () => {
      expect(decodeClient(encodeClientMessage(message))).toEqual(message);
    });
  }

  it("rejects an unknown tag with a Result failure", () => {
    const result = decodeServerMessage(`{"_tag":"nope"}`);

    expect(Result.isFailure(result)).toBe(true);
  });

  it("pins a golden encoded frame per message", () => {
    expect(encodeServerMessage(serverFixtures.ready!)).toBe(GOLDEN.ready);
    expect(encodeServerMessage(serverFixtures.snapshot!)).toBe(GOLDEN.snapshot);
    expect(encodeServerMessage(serverFixtures.patchWithOrder!)).toBe(GOLDEN.patchWithOrder);
    expect(encodeServerMessage(serverFixtures.patchWithoutOrder!)).toBe(GOLDEN.patchWithoutOrder);
    expect(encodeServerMessage(serverFixtures.error!)).toBe(GOLDEN.error);
    expect(encodeClientMessage(clientFixtures.hello!)).toBe(GOLDEN.hello);
    expect(encodeClientMessage(clientFixtures.ack!)).toBe(GOLDEN.ack);
    expect(encodeClientMessage(clientFixtures.requestSnapshot!)).toBe(GOLDEN.requestSnapshot);
  });

  it("accepts a patch with and without order", () => {
    expect(decodeServer(GOLDEN.patchWithOrder)._tag).toBe("patch");
    const withoutOrder = decodeServer(GOLDEN.patchWithoutOrder);
    expect(withoutOrder._tag).toBe("patch");
    expect("order" in withoutOrder).toBe(false);
  });

  it("rejects a snapshot without seq", () => {
    const result = decodeServerMessage(`{"_tag":"snapshot","title":null,"blocks":[]}`);

    expect(Result.isFailure(result)).toBe(true);
  });

  it("carries hast as an unknown envelope field", () => {
    const tree = [{ type: "element", tagName: "p", properties: {}, children: [] }];
    const message: ServerMessage = {
      _tag: "snapshot",
      seq: 1,
      title: null,
      blocks: [{ ...block, hast: tree }],
    };

    const decoded = decodeServer(encodeServerMessage(message));

    expect(decoded._tag === "snapshot" ? decoded.blocks[0]?.hast : null).toEqual(tree);
  });

  it("keeps PROTOCOL_VERSION in the encoded ready", () => {
    const decoded = decodeServer(GOLDEN.ready);

    expect(decoded._tag === "ready" ? decoded.protocolVersion : null).toBe(PROTOCOL_VERSION);
    expect(PROTOCOL_VERSION).toBe(1);
  });

  it("carries fileName on ready and on no document message", () => {
    const ready = decodeServer(GOLDEN.ready);
    const snapshot = decodeServer(GOLDEN.snapshot);
    const patch = decodeServer(GOLDEN.patchWithoutOrder);

    expect(ready._tag === "ready" ? ready.fileName : null).toBe("kitchen-sink.md");
    expect("fileName" in snapshot).toBe(false);
    expect("fileName" in patch).toBe(false);
  });

  it("decodes a hello carrying a different version", () => {
    const decoded = decodeClient(`{"_tag":"hello","protocolVersion":99}`);

    expect(decoded._tag === "hello" ? decoded.protocolVersion : null).toBe(99);
  });
});
