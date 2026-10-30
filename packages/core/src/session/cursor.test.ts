import { describe, expect, it } from "vitest";

import type { BlockId } from "../model.ts";

import { resolveLine, type CursorBlock } from "./cursor.ts";

const block = (id: string, startLine: number, endLine: number): CursorBlock => ({
  id: id as BlockId,
  range: { startLine, endLine },
});

const blocks: readonly CursorBlock[] = [block("b1", 1, 4), block("b2", 5, 9), block("b3", 10, 12)];

describe("line-to-block resolution", () => {
  it("resolves the block whose range contains the line", () => {
    expect(resolveLine({ blocks, line: 7, fraction: 0.5, seq: 3 })).toEqual({
      blockId: "b2",
      line: 7,
      fraction: 0.5,
      seq: 3,
    });
  });

  it("resolves nothing outside every range", () => {
    expect(resolveLine({ blocks, line: 40, fraction: 0.5, seq: 3 })).toBeNull();
  });

  it("resolves a line on a boundary to the earlier block", () => {
    expect(resolveLine({ blocks, line: 5, fraction: 0, seq: 1 })?.blockId).toBe("b2");
    expect(resolveLine({ blocks, line: 4, fraction: 0, seq: 1 })?.blockId).toBe("b1");
  });

  it("carries the sequence it resolved against", () => {
    expect(resolveLine({ blocks, line: 7, fraction: 0.25, seq: 9 })?.seq).toBe(9);
  });
});
