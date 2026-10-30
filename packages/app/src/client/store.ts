import type {
  BlockId,
  CursorMessage,
  PatchMessage,
  ServerMessage,
  SessionMessage,
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
  /** The newest display values; `null` until the session member arrives. */
  readonly session: SessionMessage | null;
  /** The newest resolved cursor; `null` until the editor sends one. */
  readonly cursor: CursorMessage | null;
};

export const emptyPreviewState: PreviewState = {
  fileName: null,
  title: null,
  lastSeq: 0,
  order: [],
  blocks: new Map(),
  banner: null,
  session: null,
  cursor: null,
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

  // Both branches sit before the document stale-seq guard (G-32).
  if (message._tag === "session") {
    return {
      ...state,
      session:
        state.session === null
          ? message
          : { ...state.session, ...message, _tag: "session" as const },
    };
  }
  if (message._tag === "cursor") {
    return message.seq < state.lastSeq ? state : { ...state, cursor: message };
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
