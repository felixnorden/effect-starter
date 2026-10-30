export type ScrollMode = "middle" | "top" | "relative";

export type PlacementInput = {
  readonly mode: ScrollMode;
  readonly blockTop: number;
  readonly blockHeight: number;
  readonly viewportHeight: number;
  readonly fraction: number;
  readonly smooth: boolean;
  readonly reducedMotion: boolean;
  readonly seq: number;
  readonly appliedSeq: number;
  readonly restore: boolean;
};

export type Placement = {
  readonly top: number;
  readonly behavior: "auto" | "smooth";
};

/**
 * One placement implementation. `blockTop` is a document offset. A cursor
 * older than the applied document is dropped; a restore, reduced motion, or a
 * configured smooth-off request takes one step.
 */
export const placement = (input: PlacementInput): Placement | null => {
  if (input.seq < input.appliedSeq) return null;

  const top =
    input.mode === "top"
      ? input.blockTop
      : input.mode === "relative"
        ? input.blockTop - input.fraction * input.viewportHeight
        : input.blockTop - (input.viewportHeight - input.blockHeight) / 2;

  return {
    top: Math.max(0, top),
    behavior: input.restore || !input.smooth || input.reducedMotion ? "auto" : "smooth",
  };
};

/** The page's pause flag and the last cursor sequence it placed. */
export type SyncState = {
  readonly paused: boolean;
  readonly lastCursorSeq: number | null;
};

export const idleSync: SyncState = { paused: false, lastCursorSeq: null };

export const handScroll = (state: SyncState): SyncState => ({ ...state, paused: true });

export const noteCursor = (state: SyncState, seq: number): SyncState => ({
  paused: false,
  lastCursorSeq: seq,
});

/** Placing is paused only by a hand scroll; the next cursor resumes it. */
export const shouldPlace = (state: SyncState): boolean => !state.paused;

/** The first cursor after a document swap (or a reload) restores, never animates. */
export const isRestore = (state: SyncState, seq: number): boolean => state.lastCursorSeq !== seq;
