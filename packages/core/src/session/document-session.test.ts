// @effect-diagnostics strictEffectProvide:off
import { it } from "@effect/vitest";
import { Effect } from "effect";
import { describe, expect } from "vitest";

import type { DocumentModel } from "../render/document.ts";
import type { BlockKind } from "../model.ts";
import { defaultRenderOptions, optionsHash } from "../render/options.ts";
import {
  DocumentSession,
  SessionError,
  type SessionResult,
  type SessionState,
} from "./document-session.ts";

const documentOf = (
  hashes: readonly string[],
  options: {
    readonly title?: string | null;
    readonly optionsHash?: string;
    readonly kinds?: readonly BlockKind[];
  } = {},
): DocumentModel => ({
  title: options.title ?? null,
  optionsHash: options.optionsHash ?? "options",
  blocks: hashes.map((hash, index) => ({
    kind: options.kinds?.[index] ?? "paragraph",
    range: { startLine: index + 1, endLine: index + 1 },
    hash,
    hast: [{ type: "text", value: hash }],
  })),
});

const apply = (previous: SessionState | null, document: DocumentModel) =>
  Effect.gen(function* () {
    const session = yield* DocumentSession;
    return yield* session.apply(previous, document);
  }).pipe(Effect.provide(DocumentSession.layer));

const resnapshot = (previous: SessionState | null, document: DocumentModel) =>
  Effect.gen(function* () {
    const session = yield* DocumentSession;
    return yield* session.resnapshot(previous, document);
  }).pipe(Effect.provide(DocumentSession.layer));

const snapshotOf = (result: SessionResult) => {
  if (result.update._tag !== "snapshot") throw new Error("expected a snapshot");
  return result.update;
};

const patchOf = (result: SessionResult) => {
  if (result.update._tag !== "patch") throw new Error("expected a patch");
  return result.update;
};

describe("DocumentSession", () => {
  it.effect("returns a snapshot with seq 1 for the first document", () =>
    Effect.gen(function* () {
      const result = yield* apply(null, documentOf(["a", "b"], { title: "Title" }));
      const snapshot = snapshotOf(result);

      expect(snapshot.seq).toBe(1);
      expect(snapshot.title).toBe("Title");
      expect(result.state.optionsHash).toBe("options");
      expect(snapshot.blocks).toHaveLength(2);
    }),
  );

  it.effect("keeps the edited block's id in the patch", () =>
    Effect.gen(function* () {
      const first = yield* apply(null, documentOf(["a", "b", "c"]));
      const second = yield* apply(first.state, documentOf(["a", "b2", "c"]));
      const patch = patchOf(second);

      expect(patch.upserts).toHaveLength(1);
      expect(patch.upserts[0]?.id).toBe(snapshotOf(first).blocks[1]?.id);
    }),
  );

  it.effect("omits order when the id sequence is unchanged", () =>
    Effect.gen(function* () {
      const first = yield* apply(null, documentOf(["a", "b", "c"]));
      const patch = patchOf(yield* apply(first.state, documentOf(["a", "b2", "c"])));

      expect("order" in patch).toBe(false);
    }),
  );

  it.effect("includes order when a block is inserted", () =>
    Effect.gen(function* () {
      const first = yield* apply(null, documentOf(["a", "b"]));
      const second = yield* apply(first.state, documentOf(["x", "a", "b"]));
      const patch = patchOf(second);

      expect(patch.upserts).toHaveLength(1);
      expect(patch.order).toEqual(second.state.blocks.map((block) => block.id));
    }),
  );

  it.effect("keeps order absent for a title-only edit", () =>
    Effect.gen(function* () {
      const first = yield* apply(null, documentOf(["a", "b"], { title: "Before" }));
      const second = yield* apply(first.state, documentOf(["a", "b"], { title: "After" }));
      const patch = patchOf(second);

      expect("order" in patch).toBe(false);
      expect(patch.title).toBe("After");
      expect(patch.upserts).toEqual([]);
      expect(patch.removed).toEqual([]);
      expect(patch.seq).toBe(first.state.seq + 1);
    }),
  );

  it.effect("sends no upsert for unchanged ids when a block is inserted above", () =>
    Effect.gen(function* () {
      const first = yield* apply(null, documentOf(["a", "b"]));
      const second = yield* apply(first.state, documentOf(["x", "a", "b"]));
      const patch = patchOf(second);

      expect(patch.upserts).toHaveLength(1);
      expect(patch.upserts[0]?.hash).toBe("x");
      expect(patch.upserts[0]?.range).toEqual({ startLine: 1, endLine: 1 });
    }),
  );

  it.effect("returns a snapshot when the options hash changes", () =>
    Effect.gen(function* () {
      const first = yield* apply(null, documentOf(["a"], { optionsHash: "one" }));
      const second = yield* apply(first.state, documentOf(["a"], { optionsHash: "two" }));

      expect(second.update._tag).toBe("snapshot");
    }),
  );

  it.effect("upserts the heading and the TOC when a heading changes", () =>
    Effect.gen(function* () {
      const first = yield* apply(
        null,
        documentOf(["toc", "heading", "b"], { kinds: ["toc", "heading", "paragraph"] }),
      );
      const second = yield* apply(
        first.state,
        documentOf(["toc2", "heading2", "b"], { kinds: ["toc", "heading", "paragraph"] }),
      );
      const patch = patchOf(second);
      const ids = snapshotOf(first).blocks.map((block) => block.id);

      expect(patch.upserts).toHaveLength(2);
      expect("order" in patch).toBe(false);
      expect(patch.upserts.map((upsert) => upsert.id)).toEqual([ids[0], ids[1]]);
    }),
  );

  it.effect("upserts the reference and the section when a footnote changes", () =>
    Effect.gen(function* () {
      const kinds: readonly BlockKind[] = ["paragraph", "paragraph", "footnote"];
      const first = yield* apply(null, documentOf(["ref", "body", "section"], { kinds }));
      const second = yield* apply(first.state, documentOf(["ref2", "body", "section2"], { kinds }));
      const patch = patchOf(second);
      const ids = snapshotOf(first).blocks.map((block) => block.id);

      expect(patch.upserts).toHaveLength(2);
      expect("order" in patch).toBe(false);
      expect(patch.upserts.map((upsert) => upsert.id)).toEqual([ids[0], ids[2]]);
    }),
  );

  it.effect("returns a snapshot when only tocListType changes", () =>
    Effect.gen(function* () {
      const first = yield* apply(
        null,
        documentOf(["a"], { optionsHash: optionsHash(defaultRenderOptions) }),
      );
      const second = yield* apply(
        first.state,
        documentOf(["a"], {
          optionsHash: optionsHash({ ...defaultRenderOptions, tocListType: "ul" }),
        }),
      );

      expect(second.update._tag).toBe("snapshot");
    }),
  );

  it.effect("increments seq by one per applied document", () =>
    Effect.gen(function* () {
      const first = yield* apply(null, documentOf(["a"]));
      const second = yield* apply(first.state, documentOf(["a"]));
      const third = yield* apply(second.state, documentOf(["a"]));

      expect([first.state.seq, second.state.seq, third.state.seq]).toEqual([1, 2, 3]);
    }),
  );

  it.effect("returns an empty-upsert patch for an unchanged document", () =>
    Effect.gen(function* () {
      const first = yield* apply(null, documentOf(["a", "b"]));
      const patch = patchOf(yield* apply(first.state, documentOf(["a", "b"])));

      expect(patch.upserts).toEqual([]);
      expect(patch.removed).toEqual([]);
      expect("order" in patch).toBe(false);
    }),
  );

  it.effect("expresses a reorder as order with no upserts", () =>
    Effect.gen(function* () {
      const first = yield* apply(null, documentOf(["a", "b"]));
      const second = yield* apply(first.state, documentOf(["b", "a"]));
      const patch = patchOf(second);

      expect(patch.order).toEqual([
        snapshotOf(first).blocks[1]?.id,
        snapshotOf(first).blocks[0]?.id,
      ]);
      expect(patch.upserts).toEqual([]);
    }),
  );

  it.effect("retires removed ids once", () =>
    Effect.gen(function* () {
      const first = yield* apply(null, documentOf(["a", "b", "c"]));
      const second = yield* apply(first.state, documentOf(["a", "c"]));
      const patch = patchOf(second);

      expect(patch.removed).toEqual([snapshotOf(first).blocks[1]?.id]);

      const third = yield* apply(second.state, documentOf(["a", "c"]));
      expect(patchOf(third).removed).toEqual([]);
    }),
  );

  it.effect("resnapshot returns the current document with the next seq", () =>
    Effect.gen(function* () {
      const first = yield* apply(null, documentOf(["a"]));
      const second = yield* apply(first.state, documentOf(["a"]));
      const third = yield* apply(second.state, documentOf(["a"]));

      const result = yield* resnapshot(third.state, documentOf(["a", "b"]));
      const snapshot = snapshotOf(result);

      expect(snapshot.seq).toBe(third.state.seq + 1);
      expect(snapshot.blocks).toHaveLength(2);
    }),
  );

  it.effect("fails with duplicateId when the previous state repeats an id", () =>
    Effect.gen(function* () {
      const first = yield* apply(null, documentOf(["a", "b"]));
      const block = first.state.blocks[0]!;
      const corrupt: SessionState = { ...first.state, blocks: [block, block] };

      const error = yield* Effect.flip(apply(corrupt, documentOf(["a"])));

      expect(error).toBeInstanceOf(SessionError);
      expect(error.reason).toBe("duplicateId");
    }),
  );
});
