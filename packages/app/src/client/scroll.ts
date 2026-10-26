import type { BlockId } from "@mdv/core/protocol";
import { useCallback, useLayoutEffect, useRef, type RefObject } from "react";

export type ScrollAnchor = { readonly blockId: BlockId; readonly offset: number };

/**
 * Tops are viewport-relative; the document stays the scroll container. The
 * anchor is the last block at or above the viewport top — the block the reader
 * is looking at.
 */
export const captureAnchor = (input: {
  readonly order: readonly BlockId[];
  readonly offsets: ReadonlyMap<BlockId, number>;
}): ScrollAnchor | null => {
  let anchor: ScrollAnchor | null = null;

  for (const blockId of input.order) {
    const offset = input.offsets.get(blockId);
    if (offset === undefined) continue;
    if (offset <= 0) anchor = { blockId, offset };
  }

  return anchor;
};

/** The scroll correction for a captured anchor, or null when the block is gone. */
export const restoreDelta = (
  anchor: ScrollAnchor,
  offsetsAfter: ReadonlyMap<BlockId, number>,
): number | null => {
  const offset = offsetsAfter.get(anchor.blockId);
  return offset === undefined ? null : offset - anchor.offset;
};

const BLOCK_SELECTOR = "[data-block-id]";

const offsetsOf = (container: HTMLElement): Map<BlockId, number> => {
  const offsets = new Map<BlockId, number>();

  for (const element of container.querySelectorAll<HTMLElement>(BLOCK_SELECTOR)) {
    const blockId = element.dataset.blockId;
    if (blockId === undefined) continue;
    offsets.set(blockId as BlockId, element.getBoundingClientRect().top);
  }

  return offsets;
};

/**
 * Capture before a patch and restore after the commit. Native anchoring is
 * disabled in CSS so the browser cannot compete with this correction.
 */
export const useScrollAnchor = (
  container: RefObject<HTMLElement | null>,
  lastSeq: number,
): (() => void) => {
  const pending = useRef<ScrollAnchor | null>(null);
  const firstRender = useRef(true);

  const beginPatch = useCallback(() => {
    const element = container.current;
    if (element === null) return;
    const offsets = offsetsOf(element);
    pending.current = captureAnchor({ order: [...offsets.keys()], offsets });
  }, [container]);

  useLayoutEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }

    const anchor = pending.current;
    pending.current = null;
    const element = container.current;
    if (anchor === null || element === null) return;

    const delta = restoreDelta(anchor, offsetsOf(element));
    if (delta === null || delta === 0) return;
    window.scrollBy(0, delta);
  }, [lastSeq, container]);

  return beginPatch;
};
