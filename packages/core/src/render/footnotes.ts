import type { LineRange } from "../model.ts";
import type { Token } from "./blocks.ts";

/** The wrapper and the item opens: both carry an empty tag and level 0. */
export const isFootnoteSectionToken = (type: string): boolean =>
  type === "footnote_block_open" || type === "footnote_open";

/** Inline tokens that render through the generated allowlist. */
export const isFootnoteInlineToken = (type: string): boolean => type === "footnote_ref";

/**
 * An open or close with no tag name. Its element is synthesized by the walker,
 * so both sides of the pair are skipped together.
 */
export const isTransparentContainer = (token: { tag: string; nesting: number }): boolean =>
  token.tag === "" && token.nesting !== 0;

/** The plugin's id family: a heading must never mint one of these. */
export const FOOTNOTE_ID_PATTERN = /^footnote(-ref)?\d+$/u;

/**
 * The union of every non-null token map in the group, or null when none carries
 * one so the builder emits a single synthetic line. Approximate: the parser
 * gives no exact section range, and the result may precede the previous block.
 */
export const footnoteSectionRange = (tokens: readonly Token[]): LineRange | null => {
  const maps = tokens.flatMap((token) => (token.map === null ? [] : [token.map]));
  if (maps.length === 0) return null;

  return {
    startLine: Math.min(...maps.map(([start]) => start + 1)),
    endLine: Math.max(...maps.map(([, end]) => end)),
  };
};
