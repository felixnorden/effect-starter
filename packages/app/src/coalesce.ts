import { Effect, Queue, Ref, Stream } from "effect";

import type { SaveEvent, WatchError } from "./watch.ts";

/** PT-4's coalescing window. */
export const COALESCE_WINDOW = "33 millis";

export type SourceSnapshot = {
  readonly source: string;
  readonly contentHash: string;
};

export type CoalesceEvent =
  | { readonly _tag: "source"; readonly snapshot: SourceSnapshot }
  | { readonly _tag: "readError"; readonly error: WatchError };

/**
 * PT-4 and PT-7 as a stream combinator: one read per window, at most one
 * pending read, the newest content wins, ENOENT is a no-op, and a source event
 * is emitted only when the content hash changed.
 */
export const coalesce = (
  events: Stream.Stream<SaveEvent, WatchError>,
  read: () => Effect.Effect<SourceSnapshot, WatchError>,
): Stream.Stream<CoalesceEvent, WatchError> =>
  Stream.callback<CoalesceEvent, WatchError>((output) =>
    Effect.gen(function* () {
      const wake = yield* Queue.sliding<void>(1);
      const pending = yield* Ref.make(0);
      const done = yield* Ref.make(false);
      const lastHash = yield* Ref.make<string | null>(null);

      yield* Effect.forkScoped(
        Stream.runForEach(events, () =>
          Effect.gen(function* () {
            yield* Ref.update(pending, (value) => value + 1);
            yield* Queue.offer(wake, undefined);
          }),
        ).pipe(
          Effect.matchCauseEffect({
            onFailure: (cause) => Queue.failCause(output, cause),
            onSuccess: () =>
              Effect.gen(function* () {
                yield* Ref.set(done, true);
                yield* Queue.offer(wake, undefined);
              }),
          }),
        ),
      );

      yield* Effect.forkScoped(
        Effect.gen(function* () {
          while (true) {
            yield* Queue.take(wake);
            const finished = yield* Ref.get(done);
            if (finished && (yield* Ref.get(pending)) === 0) {
              yield* Queue.end(output);
              return;
            }

            yield* Effect.sleep(COALESCE_WINDOW);
            // Events that arrived inside the window collapse into this read.
            yield* Ref.set(pending, 0);
            const lastWindow = yield* Ref.get(done);

            const result = yield* Effect.match(read(), {
              onFailure: (error) => ({ _tag: "error" as const, error }),
              onSuccess: (snapshot) => ({ _tag: "source" as const, snapshot }),
            });

            if (result._tag === "error") {
              if (result.error.reason !== "missing") {
                yield* Queue.offer(output, {
                  _tag: "readError",
                  error: result.error,
                });
              }
            } else {
              const previous = yield* Ref.get(lastHash);
              if (previous !== result.snapshot.contentHash) {
                yield* Ref.set(lastHash, result.snapshot.contentHash);
                yield* Queue.offer(output, {
                  _tag: "source",
                  snapshot: result.snapshot,
                });
              }
            }

            // Events that arrived during the read leave a pending wake and one
            // more read; when the stream ended and nothing is pending, stop.
            if (lastWindow && (yield* Ref.get(pending)) === 0) {
              yield* Queue.end(output);
              return;
            }
          }
        }),
      );

      return yield* Effect.never;
    }),
  );
