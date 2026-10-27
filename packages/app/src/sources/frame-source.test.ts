// @effect-diagnostics strictEffectProvide:off
import { it } from "@effect/vitest";
import { DocumentSession, type DocumentModel } from "@mdv/core";
import { EDITOR_PROTOCOL_VERSION, type DocumentMessage } from "@mdv/core/editor-protocol";
import { Effect, Fiber, Layer, Ref, Stream } from "effect";
import { describe, expect } from "vitest";

import { PreviewSession } from "../preview-session.ts";
import { createFrameSource } from "./frame-source.ts";

const documentOf = (text: string, path = "/docs/a.md"): DocumentMessage => ({
  _tag: "document",
  editorProtocolVersion: EDITOR_PROTOCOL_VERSION,
  path,
  text,
});

const modelOf = (source: string): DocumentModel => ({
  title: null,
  optionsHash: "options",
  blocks: [
    {
      range: { startLine: 1, endLine: 1 },
      kind: "heading",
      hash: `hash-${source.length}`,
      hast: [{ type: "text", value: source }],
    },
  ],
});

describe("createFrameSource", () => {
  it.effect("emits one snapshot per pushed document and reads nothing", () =>
    Effect.gen(function* () {
      const source = yield* createFrameSource({ render: (text) => Effect.succeed(modelOf(text)) });

      yield* source.push(documentOf("# one\n"));
      yield* source.push(documentOf("# two\n"));

      const events = yield* source.deps.events.pipe(Stream.take(2), Stream.runCollect);

      expect(events.map((event) => (event._tag === "source" ? event.snapshot.source : ""))).toEqual(
        ["# one\n", "# two\n"],
      );
    }),
  );

  it.effect("drops a push whose text is unchanged", () =>
    Effect.gen(function* () {
      const source = yield* createFrameSource({ render: (text) => Effect.succeed(modelOf(text)) });
      const seen = yield* Ref.make(0);
      const fiber = yield* source.deps.events.pipe(
        Stream.runForEach(() => Ref.update(seen, (count) => count + 1)),
        Effect.forkChild,
      );

      yield* source.push(documentOf("# same\n"));
      yield* source.push(documentOf("# same\n"));
      yield* Effect.forEach(Array.from({ length: 20 }), () => Effect.yieldNow, {
        discard: true,
      });

      expect(yield* Ref.get(seen)).toBe(1);
      yield* Fiber.interrupt(fiber);
    }),
  );

  it.effect("renders pushed text instead of the file on disk", () =>
    Effect.gen(function* () {
      const renders: string[] = [];
      let reads = 0;
      const source = yield* createFrameSource({
        render: (text) => {
          renders.push(text);
          return Effect.succeed(modelOf(text));
        },
      });

      const layer = PreviewSession.layer({
        ...source.deps,
        read: () =>
          Effect.sync(() => {
            reads += 1;
            return { source: "from disk", contentHash: "disk" };
          }),
      }).pipe(Layer.provide(DocumentSession.layer));

      const updates = yield* Effect.gen(function* () {
        const preview = yield* PreviewSession;
        const fiber = yield* preview.updates.pipe(
          Stream.take(1),
          Stream.runCollect,
          Effect.forkChild,
        );
        yield* source.push(documentOf("# from the buffer\n"));
        return yield* Fiber.join(fiber);
      }).pipe(Effect.provide(layer));

      expect(updates[0]?._tag).toBe("snapshot");
      expect(renders).toEqual(["# from the buffer\n"]);
      expect(reads).toBe(0);
    }),
  );

  it.effect("tolerates an empty path and binds no local root", () =>
    Effect.gen(function* () {
      const source = yield* createFrameSource({ render: (text) => Effect.succeed(modelOf(text)) });

      yield* source.push(documentOf("# unnamed\n", ""));

      const events = yield* source.deps.events.pipe(Stream.take(1), Stream.runCollect);
      expect(events).toHaveLength(1);
      expect(yield* source.localRoot).toBeNull();
    }),
  );

  it.effect("keeps the first document's local root when a later path differs", () =>
    Effect.gen(function* () {
      const source = yield* createFrameSource({ render: (text) => Effect.succeed(modelOf(text)) });

      yield* source.push(documentOf("# one\n", "/docs/a.md"));
      yield* source.push(documentOf("# two\n", "/other/b.md"));

      expect(yield* source.localRoot).toBe("/docs");
    }),
  );
});
