import type { BlockId } from "@mdv/core/protocol";
import { describe, expect, it } from "vitest";

import { captureAnchor, restoreDelta } from "./scroll.ts";

const id = (value: string): BlockId => value as BlockId;

const offsetsOf = (record: Record<string, number>): Map<BlockId, number> =>
  new Map(Object.entries(record).map(([key, value]) => [id(key), value]));

describe("captureAnchor", () => {
  it("captures the last block whose top is at or above the viewport top", () => {
    const anchor = captureAnchor({
      order: [id("a"), id("b"), id("c")],
      offsets: offsetsOf({ a: -320, b: -120, c: 40 }),
    });

    expect(anchor).toEqual({ blockId: "b", offset: -120 });
  });

  it("returns null when every block starts below the top", () => {
    const anchor = captureAnchor({
      order: [id("a"), id("b")],
      offsets: offsetsOf({ a: 10, b: 200 }),
    });

    expect(anchor).toBeNull();
  });
});

describe("restoreDelta", () => {
  it("restores by the anchor block's moved offset", () => {
    const delta = restoreDelta({ blockId: id("b"), offset: -120 }, offsetsOf({ b: 40 }));

    expect(delta).toBe(160);
  });

  it("returns null when the anchor block is gone", () => {
    const delta = restoreDelta({ blockId: id("b"), offset: -120 }, offsetsOf({ c: 40 }));

    expect(delta).toBeNull();
  });

  it("returns zero when the block did not move", () => {
    const delta = restoreDelta({ blockId: id("b"), offset: -120 }, offsetsOf({ b: -120 }));

    expect(delta).toBe(0);
  });
});
