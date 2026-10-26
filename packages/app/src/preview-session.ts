import { DocumentSession, type DocumentModel, type ServerMessage } from "@mdv/core";
import { Context, Effect, Layer, Queue, Ref, Stream } from "effect";

import type { CoalesceEvent, SourceSnapshot } from "./coalesce.ts";
import type { WatchError } from "./watch.ts";

export type PreviewSessionDeps = {
  readonly events: Stream.Stream<CoalesceEvent, WatchError>;
  readonly read: () => Effect.Effect<SourceSnapshot, WatchError>;
  /** The content hash of the source the startup render used. */
  readonly initialContentHash: string;
  /** The document the startup render produced; yields the first snapshot. */
  readonly initialDocument: DocumentModel | null;
  readonly render: (
    source: string,
  ) => Effect.Effect<DocumentModel, import("@mdv/core").RenderError>;
};

/**
 * The one place the renderer, the session, and the transport meet. It keeps the
 * last document and the session state in refs so a snapshot request can be
 * answered.
 */
export class PreviewSession extends Context.Service<
  PreviewSession,
  {
    readonly updates: Stream.Stream<ServerMessage>;
    readonly currentSnapshot: Effect.Effect<ServerMessage | null>;
    readonly readOnce: Effect.Effect<void>;
    readonly state: Effect.Effect<import("@mdv/core").SessionState | null>;
    readonly lastDocument: Effect.Effect<DocumentModel | null>;
  }
>()("@mdv/preview/PreviewSession") {
  static readonly layer = (
    deps: PreviewSessionDeps,
  ): Layer.Layer<PreviewSession, never, DocumentSession> =>
    Layer.effect(
      PreviewSession,
      Effect.gen(function* () {
        const session = yield* DocumentSession;
        const stateRef = yield* Ref.make<import("@mdv/core").SessionState | null>(null);
        const documentRef = yield* Ref.make<DocumentModel | null>(null);
        const contentHash = yield* Ref.make(deps.initialContentHash);
        const output = yield* Queue.unbounded<ServerMessage>();

        const applyDocument = Effect.fnUntraced(function* (document: DocumentModel) {
          const previous = yield* Ref.get(stateRef);
          const result = yield* session.apply(previous, document).pipe(
            Effect.catch((error) =>
              Effect.gen(function* () {
                yield* Queue.offer(output, {
                  _tag: "error" as const,
                  stage: "session",
                  message: error.message,
                });
                return null;
              }),
            ),
          );
          if (result === null) return;

          yield* Ref.set(stateRef, result.state);
          yield* Ref.set(documentRef, document);
          yield* Queue.offer(output, result.update);
        });

        const handleSnapshot = Effect.fnUntraced(function* (snapshot: SourceSnapshot) {
          const previous = yield* Ref.get(contentHash);
          if (snapshot.contentHash === previous) return;
          yield* Ref.set(contentHash, snapshot.contentHash);

          const rendered = yield* Effect.match(deps.render(snapshot.source), {
            onFailure: (error) => ({ _tag: "error" as const, error }),
            onSuccess: (document) => ({ _tag: "document" as const, document }),
          });

          if (rendered._tag === "error") {
            yield* Queue.offer(output, {
              _tag: "error",
              stage: "render",
              message: rendered.error.message,
            });
            return;
          }

          yield* applyDocument(rendered.document);
        });

        yield* Effect.forkScoped(
          Stream.runForEach(deps.events, (event) =>
            event._tag === "readError"
              ? Queue.offer(output, {
                  _tag: "error",
                  stage: "watch",
                  message: event.error.message,
                })
              : handleSnapshot(event.snapshot),
          ).pipe(
            Effect.catch((error) =>
              Queue.offer(output, {
                _tag: "error",
                stage: "watch",
                message: error.message,
              }),
            ),
          ),
        );

        const currentSnapshot: Effect.Effect<ServerMessage | null> = Effect.gen(function* () {
          const document = yield* Ref.get(documentRef);
          if (document === null) return null;

          const previous = yield* Ref.get(stateRef);
          const result = yield* session
            .resnapshot(previous, document)
            .pipe(Effect.orElseSucceed(() => null));
          if (result === null) return null;

          yield* Ref.set(stateRef, result.state);
          return result.update;
        });

        const readOnce = Effect.gen(function* () {
          const readResult = yield* Effect.match(deps.read(), {
            onFailure: (error) => ({ _tag: "error" as const, error }),
            onSuccess: (snapshot) => ({ _tag: "source" as const, snapshot }),
          });

          if (readResult._tag === "error") {
            if (readResult.error.reason !== "missing") {
              yield* Queue.offer(output, {
                _tag: "error",
                stage: "watch",
                message: readResult.error.message,
              });
            }
            return;
          }

          yield* handleSnapshot(readResult.snapshot);
        });

        if (deps.initialDocument !== null) {
          yield* applyDocument(deps.initialDocument);
        }

        return PreviewSession.of({
          updates: Stream.fromQueue(output),
          currentSnapshot,
          readOnce,
          state: Ref.get(stateRef),
          lastDocument: Ref.get(documentRef),
        });
      }),
    );
}
