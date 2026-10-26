// @effect-diagnostics strictEffectProvide:off
import { it } from "@effect/vitest";
import { DocumentSession, RenderError, type DocumentModel } from "@mdv/core";
import { Effect, Fiber, Layer, Queue, Stream } from "effect";
import { describe, expect } from "vitest";

import type { CoalesceEvent } from "./coalesce.ts";
import { PreviewSession } from "./preview-session.ts";
import { WatchError } from "./watch.ts";

const documentOf = (
  hashes: readonly string[],
  options: { readonly title?: string | null } = {},
): DocumentModel => ({
  title: options.title ?? null,
  optionsHash: "options",
  blocks: hashes.map((hash, index) => ({
    kind: "paragraph",
    range: { startLine: index + 1, endLine: index + 1 },
    hash,
    hast: [],
  })),
});

const sourceEvent = (source: string, contentHash: string): CoalesceEvent => ({
  _tag: "source",
  snapshot: { source, contentHash },
});

const render = (documents: Readonly<Record<string, DocumentModel>>) => (source: string) =>
  source.includes("RENDER_FAIL")
    ? Effect.fail(new RenderError({ stage: "parse", line: 1, message: "boom" }))
    : Effect.succeed(documents[source] ?? documentOf([source]));

const layerOf = (
  events: Stream.Stream<CoalesceEvent, WatchError>,
  documents: Readonly<Record<string, DocumentModel>>,
) =>
  PreviewSession.layer({
    events,
    read: () => Effect.succeed({ source: "restart", contentHash: "initial" }),
    initialContentHash: "initial",
    initialDocument: null,
    render: render(documents),
  }).pipe(Layer.provide(DocumentSession.layer));

const collectUpdates = (count: number) =>
  Effect.gen(function* () {
    const preview = yield* PreviewSession;
    return yield* preview.updates.pipe(Stream.take(count), Stream.runCollect);
  });

describe("PreviewSession", () => {
  it.effect("emits a snapshot for the first source", () => {
    const documents = { a: documentOf(["a"], { title: "Title" }) };

    return collectUpdates(1).pipe(
      Effect.map((updates) => {
        expect(updates[0]).toMatchObject({ _tag: "snapshot", seq: 1, title: "Title" });
      }),
      Effect.provide(layerOf(Stream.make(sourceEvent("a", "h1")), documents)),
    );
  });

  it.effect("emits one patch whose upsert keeps the edited block's id", () => {
    const documents = {
      a: documentOf(["a", "b"]),
      b: documentOf(["a", "b2"]),
    };

    return Effect.gen(function* () {
      const updates = yield* collectUpdates(2);
      const snapshot = updates[0];
      const patch = updates[1];
      if (snapshot?._tag !== "snapshot" || patch?._tag !== "patch") {
        throw new Error("expected a snapshot then a patch");
      }

      expect(patch.upserts).toHaveLength(1);
      expect(patch.upserts[0]?.id).toBe(snapshot.blocks[1]?.id);
    }).pipe(
      Effect.provide(
        layerOf(Stream.make(sourceEvent("a", "h1"), sourceEvent("b", "h2")), documents),
      ),
    );
  });

  it.effect("emits nothing for an unchanged save", () => {
    const documents = { a: documentOf(["a"]) };
    const input = Effect.runSync(Queue.unbounded<CoalesceEvent>());

    return Effect.gen(function* () {
      const preview = yield* PreviewSession;
      const fiber = yield* preview.updates.pipe(
        Stream.take(1),
        Stream.runCollect,
        Effect.forkChild,
      );

      yield* Queue.offer(input, sourceEvent("a", "same"));
      yield* Fiber.join(fiber);
      const before = yield* preview.state;

      yield* Queue.offer(input, sourceEvent("a", "same"));
      yield* Effect.yieldNow;
      yield* Effect.yieldNow;
      const after = yield* preview.state;

      expect(after?.seq).toBe(before?.seq);
    }).pipe(Effect.provide(layerOf(Stream.fromQueue(input), documents)));
  });

  it.effect("emits an error with stage render and keeps the last document", () => {
    const documents = { a: documentOf(["a"]) };
    const input = Effect.runSync(Queue.unbounded<CoalesceEvent>());

    return Effect.gen(function* () {
      const preview = yield* PreviewSession;
      const fiber = yield* preview.updates.pipe(
        Stream.take(2),
        Stream.runCollect,
        Effect.forkChild,
      );

      yield* Queue.offer(input, sourceEvent("a", "h1"));
      yield* Queue.offer(input, sourceEvent("RENDER_FAIL", "h2"));

      const updates = yield* Fiber.join(fiber);
      expect(updates[1]).toMatchObject({ _tag: "error", stage: "render" });
      const document = yield* preview.lastDocument;
      expect(document?.title).toBeNull();
      expect(document?.blocks).toHaveLength(1);
    }).pipe(Effect.provide(layerOf(Stream.fromQueue(input), documents)));
  });

  it.effect("emits an error with stage watch when the watcher fails", () => {
    const failure = new WatchError({
      path: "/docs/a.md",
      reason: "other",
      message: "emitter failed",
    });

    return collectUpdates(1).pipe(
      Effect.map((updates) => {
        expect(updates[0]).toMatchObject({ _tag: "error", stage: "watch" });
      }),
      Effect.provide(layerOf(Stream.fail(failure), {})),
    );
  });

  it.effect("emits a title-only patch with no order and no upserts", () => {
    const documents = {
      a: documentOf(["a", "b"], { title: "Before" }),
      b: documentOf(["a", "b"], { title: "After" }),
    };

    return Effect.gen(function* () {
      const updates = yield* collectUpdates(2);
      const patch = updates[1];
      if (patch?._tag !== "patch") throw new Error("expected a patch");

      expect(patch.title).toBe("After");
      expect("order" in patch).toBe(false);
      expect(patch.upserts).toEqual([]);
    }).pipe(
      Effect.provide(
        layerOf(Stream.make(sourceEvent("a", "h1"), sourceEvent("b", "h2")), documents),
      ),
    );
  });

  it.effect("keeps the last document when a read error arrives", () => {
    const documents = { a: documentOf(["a"], { title: "Title" }) };
    const input = Effect.runSync(Queue.unbounded<CoalesceEvent>());

    return Effect.gen(function* () {
      const preview = yield* PreviewSession;
      const fiber = yield* preview.updates.pipe(
        Stream.take(2),
        Stream.runCollect,
        Effect.forkChild,
      );

      yield* Queue.offer(input, sourceEvent("a", "h1"));
      yield* Queue.offer(input, {
        _tag: "readError",
        error: new WatchError({
          path: "/docs/a.md",
          reason: "permission",
          message: "denied",
        }),
      });

      const updates = yield* Fiber.join(fiber);
      expect(updates[1]).toMatchObject({ _tag: "error", stage: "watch" });
      const document = yield* preview.lastDocument;
      expect(document?.title).toBe("Title");
    }).pipe(Effect.provide(layerOf(Stream.fromQueue(input), documents)));
  });

  it.effect("answers a snapshot request with resnapshot and a higher seq", () => {
    const documents = { a: documentOf(["a"]) };

    return Effect.gen(function* () {
      const preview = yield* PreviewSession;
      const updates = yield* collectUpdates(1);
      expect(updates[0]).toMatchObject({ _tag: "snapshot", seq: 1 });

      const snapshot = yield* preview.currentSnapshot;
      expect(snapshot).toMatchObject({ _tag: "snapshot", seq: 2 });
    }).pipe(Effect.provide(layerOf(Stream.make(sourceEvent("a", "h1")), documents)));
  });
});
