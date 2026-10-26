import type {
  BlockId,
  PatchMessage,
  ServerMessage,
  SnapshotMessage,
  WireBlock,
} from "@mdv/core/protocol";

export type Banner = {
  readonly stage: string;
  readonly message: string;
};

/** Everything the page keeps between server messages. */
export type PreviewState = {
  readonly fileName: string | null;
  readonly title: string | null;
  readonly lastSeq: number;
  readonly order: readonly BlockId[];
  readonly blocks: ReadonlyMap<BlockId, WireBlock>;
  readonly banner: Banner | null;
};

export const emptyPreviewState: PreviewState = {
  fileName: null,
  title: null,
  lastSeq: 0,
  order: [],
  blocks: new Map(),
  banner: null,
};

/**
 * The whole client contract is this pure reducer: an optional order, upserts,
 * removals, a stale-seq guard, and the last good document behind a banner.
 */
export const applyServerMessage = (state: PreviewState, message: ServerMessage): PreviewState => {
  if (message._tag === "ready") return { ...state, fileName: message.fileName };

  if (message._tag === "error") {
    return { ...state, banner: { stage: message.stage, message: message.message } };
  }

  if (message.seq <= state.lastSeq) return state; // PT-3

  if (message._tag === "snapshot") return applySnapshot(state, message);

  return applyPatch(state, message);
};

const applySnapshot = (state: PreviewState, message: SnapshotMessage): PreviewState => ({
  ...state,
  title: message.title,
  lastSeq: message.seq,
  order: message.blocks.map((block) => block.id),
  blocks: new Map(message.blocks.map((block) => [block.id, block] as const)),
  banner: null,
});

const applyPatch = (state: PreviewState, message: PatchMessage): PreviewState => {
  const blocks = new Map(state.blocks);
  for (const block of message.upserts) blocks.set(block.id, block);
  for (const id of message.removed) blocks.delete(id);

  return {
    ...state,
    title: message.title,
    lastSeq: message.seq,
    order: message.order ?? state.order,
    blocks,
    banner: null,
  };
};
