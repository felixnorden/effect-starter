import type {
  BlockId,
  CursorMessage,
  PatchMessage,
  SessionMessage,
  SnapshotMessage,
  WireBlock,
} from "@mdv/core/protocol";
import { describe, expect, it } from "vitest";

import { applyServerMessage, emptyPreviewState, type PreviewState } from "./store.ts";

const blockOf = (id: string, hash = id, rangeLine = 1): WireBlock => ({
  id: id as BlockId,
  hash,
  kind: "paragraph",
  range: { startLine: rangeLine, endLine: rangeLine },
  hast: [],
});

const snapshotOf = (
  blocks: readonly WireBlock[],
  options: { readonly seq?: number; readonly title?: string | null } = {},
): SnapshotMessage => ({
  _tag: "snapshot",
  seq: options.seq ?? 1,
  title: options.title ?? null,
  blocks,
});

const patchOf = (options: {
  readonly seq: number;
  readonly upserts?: readonly WireBlock[];
  readonly removed?: readonly BlockId[];
  readonly order?: readonly BlockId[];
  readonly title?: string | null;
}): PatchMessage => ({
  _tag: "patch",
  seq: options.seq,
  title: options.title ?? null,
  ...(options.order === undefined ? {} : { order: options.order }),
  upserts: options.upserts ?? [],
  removed: options.removed ?? [],
});

const readyOf = (fileName: string) => ({
  _tag: "ready" as const,
  protocolVersion: 1,
  title: null,
  fileName,
});

const sessionOf = (overrides: Partial<SessionMessage>): SessionMessage => ({
  _tag: "session",
  fileName: "a.md",
  title: "a.md",
  showFileName: true,
  width: "900px",
  fontSize: "16px",
  markdownCss: null,
  codeCss: null,
  scrollMode: "middle",
  smoothScroll: true,
  themeMode: "system",
  ...overrides,
});

const cursorOf = (options: { readonly seq: number }): CursorMessage => ({
  _tag: "cursor",
  blockId: "a" as BlockId,
  line: 1,
  fraction: 0.5,
  seq: options.seq,
});

const errorOf = (stage: string, message: string) => ({
  _tag: "error" as const,
  stage,
  message,
});

const stateWith = (blocks: readonly WireBlock[]): PreviewState =>
  applyServerMessage(emptyPreviewState, snapshotOf(blocks));

describe("applyServerMessage", () => {
  it("applies a snapshot's order and blocks to an empty state", () => {
    const state = stateWith([blockOf("a"), blockOf("b")]);

    expect(state.order).toEqual(["a", "b"]);
    expect(state.blocks.size).toBe(2);
    expect(state.lastSeq).toBe(1);
  });

  it("drops a patch whose seq is not newer", () => {
    const state = stateWith([blockOf("a")]);
    const withSeq: PreviewState = { ...state, lastSeq: 5 };

    const next = applyServerMessage(
      withSeq,
      patchOf({ seq: 5, upserts: [blockOf("a", "changed")] }),
    );

    expect(next).toBe(withSeq);
  });

  it("applies a newer patch after a stale one was dropped", () => {
    const state = stateWith([blockOf("a")]);

    const next = applyServerMessage(state, patchOf({ seq: 2, upserts: [blockOf("a", "changed")] }));

    expect(next.blocks.get("a" as BlockId)?.hash).toBe("changed");
  });

  it("inserts a block at the patch's order position", () => {
    const state = stateWith([blockOf("a"), blockOf("c")]);

    const next = applyServerMessage(
      state,
      patchOf({
        seq: 2,
        order: ["a" as BlockId, "b" as BlockId, "c" as BlockId],
        upserts: [blockOf("b")],
      }),
    );

    expect(next.order).toEqual(["a", "b", "c"]);
    expect(next.blocks.size).toBe(3);
  });

  it("replaces an upsert and keeps its position", () => {
    const state = stateWith([blockOf("a"), blockOf("b")]);
    const replacement = blockOf("b", "changed");

    const next = applyServerMessage(state, patchOf({ seq: 2, upserts: [replacement] }));

    expect(next.order).toEqual(["a", "b"]);
    expect(next.blocks.get("b" as BlockId)).toBe(replacement);
  });

  it("keeps the order when a patch has no order", () => {
    const state = stateWith([blockOf("a"), blockOf("b"), blockOf("c")]);
    const before = state.order;

    const next = applyServerMessage(state, patchOf({ seq: 2, upserts: [blockOf("b", "changed")] }));

    expect(next.order).toBe(before);
  });

  it("keeps the last ranges when an unchanged block shifts", () => {
    const state = stateWith([blockOf("a", "a", 1), blockOf("b", "b", 2)]);

    const next = applyServerMessage(
      state,
      patchOf({
        seq: 2,
        order: ["x" as BlockId, "a" as BlockId, "b" as BlockId],
        upserts: [blockOf("x", "x", 1)],
      }),
    );

    expect(next.blocks.get("a" as BlockId)?.range).toEqual({ startLine: 1, endLine: 1 });
    expect(next.blocks.get("b" as BlockId)?.range).toEqual({ startLine: 2, endLine: 2 });
  });

  it("removes a block named in removed", () => {
    const state = stateWith([blockOf("a"), blockOf("b")]);

    const next = applyServerMessage(
      state,
      patchOf({ seq: 2, order: ["a" as BlockId], removed: ["b" as BlockId] }),
    );

    expect(next.order).toEqual(["a"]);
    expect(next.blocks.has("b" as BlockId)).toBe(false);
  });

  it("expresses a reorder without upserts", () => {
    const state = stateWith([blockOf("a"), blockOf("b")]);

    const next = applyServerMessage(
      state,
      patchOf({ seq: 2, order: ["b" as BlockId, "a" as BlockId] }),
    );

    expect(next.order).toEqual(["b", "a"]);
    expect(next.blocks.size).toBe(2);
  });

  it("sets the banner and keeps the last document on an error", () => {
    const state = stateWith([blockOf("a")]);

    const next = applyServerMessage(state, errorOf("render", "boom"));

    expect(next.banner).toEqual({ stage: "render", message: "boom" });
    expect(next.order).toBe(state.order);
    expect(next.blocks).toBe(state.blocks);
  });

  it("clears the banner when the next update applies", () => {
    const state = applyServerMessage(stateWith([blockOf("a")]), errorOf("render", "boom"));

    const next = applyServerMessage(state, patchOf({ seq: 2, upserts: [blockOf("a", "changed")] }));

    expect(next.banner).toBeNull();
  });

  it("takes the title from a patch", () => {
    const state = applyServerMessage(
      stateWith([blockOf("a")]),
      patchOf({ seq: 2, title: "New Title" }),
    );

    expect(state.title).toBe("New Title");
  });

  it("records the file name from ready and keeps it across patches", () => {
    const empty = applyServerMessage(emptyPreviewState, readyOf("kitchen-sink.md"));
    expect(empty.fileName).toBe("kitchen-sink.md");

    const state = applyServerMessage(empty, snapshotOf([blockOf("a")]));
    const next = applyServerMessage(state, patchOf({ seq: 2, upserts: [blockOf("a", "changed")] }));

    expect(next.fileName).toBe("kitchen-sink.md");
  });

  it("keeps the newest session member's values, field by field", () => {
    const first = sessionOf({ width: "800px", fontSize: "15px" });
    const second = sessionOf({ width: "1200px", fontSize: "18px" });

    const afterFirst = applyServerMessage(emptyPreviewState, first);
    const afterSecond = applyServerMessage(afterFirst, second);

    expect(afterSecond.session).toMatchObject({ width: "1200px", fontSize: "18px" });
    expect(afterSecond.session?.title).toBe("a.md");
  });

  it("a session member changes neither lastSeq nor the block map", () => {
    const state = stateWith([blockOf("a")]);

    const next = applyServerMessage(state, sessionOf({}));

    expect(next.lastSeq).toBe(state.lastSeq);
    expect(next.order).toEqual(state.order);
    expect(next.blocks).toBe(state.blocks);
  });

  it("a cursor member changes neither the order nor the blocks", () => {
    const state = stateWith([blockOf("a")]);

    const next = applyServerMessage(state, cursorOf({ seq: 1 }));

    expect(next.cursor).toEqual(cursorOf({ seq: 1 }));
    expect(next.lastSeq).toBe(state.lastSeq);
    expect(next.order).toBe(state.order);
    expect(next.blocks).toBe(state.blocks);
  });

  it("a cursor older than the applied document is dropped", () => {
    const state: PreviewState = { ...stateWith([blockOf("a")]), lastSeq: 5 };

    const next = applyServerMessage(state, cursorOf({ seq: 2 }));

    expect(next).toBe(state);
    expect(next.cursor).toBeNull();
  });

  it("both new members are handled before the document stale-seq guard", () => {
    const state: PreviewState = { ...stateWith([blockOf("a")]), lastSeq: 5 };

    const withSession = applyServerMessage(state, sessionOf({ width: "1000px" }));
    const withCursor = applyServerMessage(withSession, cursorOf({ seq: 5 }));

    expect(withCursor.session?.width).toBe("1000px");
    expect(withCursor.cursor?.seq).toBe(5);
    expect(withCursor.lastSeq).toBe(5);
    expect(withCursor.blocks.size).toBe(1);
  });
});
