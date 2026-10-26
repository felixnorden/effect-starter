import type { BlockId } from "../model.ts";

export type BlockIdentity = {
  readonly id: BlockId;
  readonly hash: string;
};

export type BlockDiff = {
  readonly assignments: readonly (BlockId | null)[];
  readonly removed: readonly BlockId[];
};

/**
 * Greedy hash match, then a position zip.
 *
 * 1. Index the previous blocks by hash and match the next hashes one-to-one, in
 *    order, so an edited block keeps its id and duplicate hashes match in turn.
 * 2. Zip the leftover previous ids with the leftover next positions, so a
 *    delete plus an insert at the same position is an edit.
 * 3. Extra next positions mint (`null`); extra previous ids retire.
 */
export const diffBlocks = (
  previous: readonly BlockIdentity[],
  next: readonly string[],
): BlockDiff => {
  const byHash = new Map<string, number[]>();
  for (const [index, block] of previous.entries()) {
    const queue = byHash.get(block.hash);
    if (queue === undefined) byHash.set(block.hash, [index]);
    else queue.push(index);
  }

  const assignments: (BlockId | null)[] = next.map(() => null);
  const matched = new Set<number>();

  for (const [index, hash] of next.entries()) {
    const queue = byHash.get(hash);
    const previousIndex = queue?.shift();
    if (previousIndex === undefined) continue;
    assignments[index] = previous[previousIndex]?.id ?? null;
    matched.add(previousIndex);
  }

  const leftoverPrevious = previous.map((_, index) => index).filter((index) => !matched.has(index));
  const holes = assignments
    .map((assignment, index) => (assignment === null ? index : -1))
    .filter((index) => index !== -1);

  const replacements = Math.min(leftoverPrevious.length, holes.length);
  for (let index = 0; index < replacements; index += 1) {
    const previousIndex = leftoverPrevious[index];
    const hole = holes[index];
    if (previousIndex === undefined || hole === undefined) continue;
    assignments[hole] = previous[previousIndex]?.id ?? null;
  }

  const removed = leftoverPrevious
    .slice(replacements)
    .map((index) => previous[index])
    .filter((block): block is BlockIdentity => block !== undefined)
    .map((block) => block.id);

  return { assignments, removed };
};
