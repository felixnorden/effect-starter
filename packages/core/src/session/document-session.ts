import { Context, Effect, Layer, Ref, Schema } from "effect";

import type { BlockId } from "../model.ts";
import type { Block, DocumentModel } from "../render/document.ts";
import { diffBlocks } from "./block-diff.ts";
import type { DocumentUpdate, PatchMessage, SnapshotMessage, WireBlock } from "../protocol.ts";

export class SessionError extends Schema.TaggedError<
  SessionError,
  { readonly brand: unique symbol }
>()("SessionError", {
  reason: Schema.Literals(["duplicateId"]),
  message: Schema.String,
}) {}

/** Everything the session keeps between documents, including the wire blocks. */
export type SessionState = {
  readonly seq: number;
  readonly title: string | null;
  readonly optionsHash: string;
  readonly blocks: readonly WireBlock[];
};

export type SessionResult = {
  readonly state: SessionState;
  readonly update: DocumentUpdate;
};

const toWire = (block: Block, id: BlockId): WireBlock => ({
  id,
  hash: block.hash,
  kind: block.kind,
  range: block.range,
  hast: block.hast,
});

/**
 * The identity and sequencing state machine. First paint yields a snapshot;
 * every later change yields a patch whose `order` appears only when the id
 * sequence changed.
 */
export class DocumentSession extends Context.Service<
  DocumentSession,
  {
    readonly apply: (
      previous: SessionState | null,
      document: DocumentModel,
    ) => Effect.Effect<SessionResult, SessionError>;
    readonly resnapshot: (
      previous: SessionState | null,
      document: DocumentModel,
    ) => Effect.Effect<SessionResult, SessionError>;
  }
>()("@mdv/core/DocumentSession") {
  static readonly layer: Layer.Layer<DocumentSession> = Layer.effect(
    DocumentSession,
    Effect.gen(function* () {
      const nextId = yield* Ref.make(1);

      const mint = Effect.fnUntraced(function* () {
        const id = yield* Ref.getAndUpdate(nextId, (value) => value + 1);
        return `b${id}` as BlockId;
      });

      const assignIds = Effect.fnUntraced(function* (
        previous: SessionState | null,
        document: DocumentModel,
      ) {
        const diff = diffBlocks(
          (previous?.blocks ?? []).map((block) => ({ id: block.id, hash: block.hash })),
          document.blocks.map((block) => block.hash),
        );

        const ids: BlockId[] = [];
        for (const assignment of diff.assignments) {
          ids.push(assignment ?? (yield* mint()));
        }
        return { ids, removed: diff.removed };
      });

      const validate = Effect.fnUntraced(function* (previous: SessionState | null) {
        if (previous === null) return;
        const seen = new Set<string>();
        for (const block of previous.blocks) {
          if (seen.has(block.id)) {
            return yield* new SessionError({
              reason: "duplicateId",
              message: `duplicate block id ${block.id}`,
            });
          }
          seen.add(block.id);
        }
      });

      const snapshot = Effect.fnUntraced(function* (
        previous: SessionState | null,
        document: DocumentModel,
      ) {
        const { ids } = yield* assignIds(previous, document);
        const state: SessionState = {
          seq: (previous?.seq ?? 0) + 1,
          title: document.title,
          optionsHash: document.optionsHash,
          blocks: document.blocks.map((block, index) => toWire(block, ids[index]!)),
        };
        const update: SnapshotMessage = {
          _tag: "snapshot",
          seq: state.seq,
          title: state.title,
          blocks: state.blocks,
        };
        return { state, update };
      });

      const patch = Effect.fnUntraced(function* (previous: SessionState, document: DocumentModel) {
        const { ids, removed } = yield* assignIds(previous, document);
        const blocks = document.blocks.map((block, index) => toWire(block, ids[index]!));
        const previousById = new Map(previous.blocks.map((block) => [block.id, block] as const));
        const upserts = blocks.filter((block) => {
          const before = previousById.get(block.id);
          return before === undefined || before.hash !== block.hash;
        });

        const idSequenceChanged =
          blocks.length !== previous.blocks.length ||
          blocks.some((block, index) => block.id !== previous.blocks[index]?.id);

        const state: SessionState = {
          seq: previous.seq + 1,
          title: document.title,
          optionsHash: document.optionsHash,
          blocks,
        };
        const update: PatchMessage = {
          _tag: "patch",
          seq: state.seq,
          title: state.title,
          ...(idSequenceChanged ? { order: ids } : {}),
          upserts,
          removed,
        };
        return { state, update };
      });

      const apply = Effect.fn("DocumentSession.apply")(function* (
        previous: SessionState | null,
        document: DocumentModel,
      ) {
        yield* validate(previous);
        if (previous !== null && previous.optionsHash === document.optionsHash) {
          return yield* patch(previous, document);
        }
        return yield* snapshot(previous, document);
      });

      const resnapshot = Effect.fn("DocumentSession.resnapshot")(function* (
        previous: SessionState | null,
        document: DocumentModel,
      ) {
        yield* validate(previous);
        return yield* snapshot(previous, document);
      });

      return DocumentSession.of({ apply, resnapshot });
    }),
  );
}
