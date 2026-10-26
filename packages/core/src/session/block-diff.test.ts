import type { BlockId } from "../model.ts";
import { describe, expect, it } from "vitest";

import { diffBlocks, type BlockIdentity } from "./block-diff.ts";

const identity = (...hashes: readonly string[]): BlockIdentity[] =>
  hashes.map((hash, index) => ({ id: `id${index + 1}` as BlockId, hash }));

describe("diffBlocks", () => {
  it("carries every id when the hash list is unchanged", () => {
    const diff = diffBlocks(identity("a", "b", "c"), ["a", "b", "c"]);

    expect(diff.assignments).toEqual(["id1", "id2", "id3"]);
    expect(diff.removed).toEqual([]);
  });

  it("keeps the id of a block whose content changed in place", () => {
    const diff = diffBlocks(identity("a", "b", "c"), ["a", "b2", "c"]);

    expect(diff.assignments).toEqual(["id1", "id2", "id3"]);
    expect(diff.removed).toEqual([]);
  });

  it("mints one id for an inserted block and keeps the others", () => {
    const diff = diffBlocks(identity("a", "b"), ["x", "a", "b"]);

    expect(diff.assignments).toEqual([null, "id1", "id2"]);
  });

  it("reports a deleted block's id as removed", () => {
    const diff = diffBlocks(identity("a", "b", "c"), ["a", "c"]);

    expect(diff.assignments).toEqual(["id1", "id3"]);
    expect(diff.removed).toEqual(["id2"]);
  });

  it("keeps both ids when two blocks swap", () => {
    const diff = diffBlocks(identity("a", "b"), ["b", "a"]);

    expect(diff.assignments).toEqual(["id2", "id1"]);
    expect(diff.removed).toEqual([]);
  });

  it("assigns distinct ids to two blocks with identical hashes", () => {
    expect(diffBlocks([], ["a", "a"]).assignments).toEqual([null, null]);
    expect(diffBlocks(identity("a"), ["a", "a"]).assignments).toEqual(["id1", null]);
  });

  it("returns no assignments for an empty previous state and a non-empty next", () => {
    expect(diffBlocks([], ["a", "b"]).assignments).toEqual([null, null]);
  });

  it("treats two leftover positions as two edits", () => {
    const diff = diffBlocks(identity("a", "b"), ["x", "b2"]);

    expect(diff.assignments).toEqual(["id1", "id2"]);
    expect(diff.removed).toEqual([]);
  });

  it("retires extra previous ids when the next list is shorter", () => {
    const diff = diffBlocks(identity("a", "b", "c"), ["a"]);

    expect(diff.assignments).toEqual(["id1"]);
    expect(diff.removed).toEqual(["id2", "id3"]);
  });

  it("mints for extra next ids when the next list is longer", () => {
    const diff = diffBlocks(identity("a", "b"), ["a", "b", "x"]);

    expect(diff.assignments).toEqual(["id1", "id2", null]);
  });
});
