import type { DocumentModel, RenderError } from "@mdv/core";
import type { DocumentMessage } from "@mdv/core/editor-protocol";
import { Effect, Queue, Ref, Stream } from "effect";
import { dirname } from "node:path";

import type { CoalesceEvent, SourceSnapshot } from "../coalesce.ts";
import type { PreviewSessionDeps } from "../preview-session.ts";
import { hashSource } from "./file-source.ts";

type RootState = {
  readonly set: boolean;
  readonly dir: string | null;
};

export type FrameSource = {
  readonly deps: PreviewSessionDeps;
  /** One push per document frame. Identical text pushes nothing. */
  readonly push: (document: DocumentMessage) => Effect.Effect<void>;
  /** Fixed at the first document's path; `null` when that path is empty. */
  readonly localRoot: Effect.Effect<string | null>;
};

/**
 * An editor session reads nothing and watches nothing: frames are the only
 * events. The content-hash gate is the same one the file source gets from
 * `coalesce`.
 */
export const createFrameSource = (options: {
  readonly render: (source: string) => Effect.Effect<DocumentModel, RenderError>;
}): Effect.Effect<FrameSource> =>
  Effect.gen(function* () {
    const events = yield* Queue.unbounded<CoalesceEvent>();
    const snapshot = yield* Ref.make<SourceSnapshot | null>(null);
    const root = yield* Ref.make<RootState>({ set: false, dir: null });

    const deps: PreviewSessionDeps = {
      events: Stream.fromQueue(events),
      read: () =>
        Effect.gen(function* () {
          const held = yield* Ref.get(snapshot);
          return held ?? { source: "", contentHash: "" };
        }),
      // The first push is always a change.
      initialContentHash: "",
      initialDocument: null,
      render: options.render,
    };

    const push = (document: DocumentMessage): Effect.Effect<void> =>
      Effect.gen(function* () {
        const contentHash = hashSource(document.text);
        const previous = yield* Ref.get(snapshot);
        if (previous !== null && previous.contentHash === contentHash) return;

        const next = { source: document.text, contentHash };
        yield* Ref.set(snapshot, next);
        yield* Queue.offer(events, { _tag: "source", snapshot: next });

        const currentRoot = yield* Ref.get(root);
        if (!currentRoot.set) {
          yield* Ref.set(root, {
            set: true,
            dir: document.path === "" ? null : dirname(document.path),
          });
        }
      });

    return { deps, push, localRoot: Ref.get(root).pipe(Effect.map((state) => state.dir)) };
  });
