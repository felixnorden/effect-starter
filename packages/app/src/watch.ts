import { Cause, Effect, Queue, Schema, Stream } from "effect";
import { watch as nodeWatch } from "node:fs";
import { join } from "node:path";

export type SaveEvent = {
  readonly path: string;
  readonly event: string;
};

export class WatchError extends Schema.TaggedError<WatchError, { readonly brand: unique symbol }>()(
  "WatchError",
  {
    path: Schema.String,
    reason: Schema.Literals(["missing", "permission", "other"]),
    message: Schema.String,
  },
) {}

export type WatcherLike = {
  readonly on: (event: "error", listener: (error: unknown) => void) => unknown;
  readonly close: () => void;
};

export type WatchFn = (
  dir: string,
  listener: (event: string, filename: string | null) => void,
) => WatcherLike;

const describeCause = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

/**
 * Watch the containing directory, because an atomic save is only fully visible
 * there. The event name is diagnostics only; every consumer re-reads the file.
 */
export const watchDirectory = (
  dir: string,
  watchFn: WatchFn = nodeWatch as unknown as WatchFn,
): Stream.Stream<SaveEvent, WatchError> =>
  Stream.callback<SaveEvent, WatchError>((queue) =>
    Effect.gen(function* () {
      const watcher = watchFn(dir, (event, filename) => {
        Queue.offerUnsafe(queue, {
          path: filename === null ? dir : join(dir, String(filename)),
          event,
        });
      });

      watcher.on("error", (cause) => {
        Queue.failCauseUnsafe(
          queue,
          Cause.fail(
            new WatchError({
              path: dir,
              reason: "other",
              message: describeCause(cause),
            }),
          ),
        );
      });

      yield* Effect.addFinalizer(() => Effect.sync(() => watcher.close()));
      return yield* Effect.never;
    }),
  );
