import type { BlockId, LineRange } from "../model.ts";

/** The part of a wire block the resolver needs: identity and top-level range. */
export type CursorBlock = {
  readonly id: BlockId;
  readonly range: LineRange;
};

export type ResolvedLine = {
  readonly blockId: BlockId;
  readonly line: number;
  readonly fraction: number;
  readonly seq: number;
};

/**
 * The block whose top-level range contains the 1-based line, or `null`. The
 * first match wins, so a boundary line belongs to the block that starts there.
 * Resolution changes nothing: the page receives the line as the editor sent it.
 */
export const resolveLine = (input: {
  readonly blocks: readonly CursorBlock[];
  readonly line: number;
  readonly fraction: number;
  readonly seq: number;
}): ResolvedLine | null => {
  for (const block of input.blocks) {
    if (input.line >= block.range.startLine && input.line <= block.range.endLine) {
      return {
        blockId: block.id,
        line: input.line,
        fraction: input.fraction,
        seq: input.seq,
      };
    }
  }
  return null;
};
