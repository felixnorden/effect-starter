import { it } from "@effect/vitest";
import { Effect, Fiber, Stream } from "effect";
import { describe, expect } from "vitest";

import { watchDirectory, type WatchFn } from "./watch.ts";

const fakeWatcher = () => {
  let listener: ((event: string, filename: string | null) => void) | undefined;
  let onError: ((error: unknown) => void) | undefined;
  let closes = 0;

  const watchFn: WatchFn = (_dir, nextListener) => {
    listener = nextListener;
    return {
      on: (event, nextErrorListener) => {
        if (event === "error") onError = nextErrorListener;
      },
      close: () => {
        closes += 1;
      },
    };
  };

  return {
    watchFn,
    emit: (event: string, filename: string | null) => listener?.(event, filename),
    fail: (error: unknown) => onError?.(error),
    get closes() {
      return closes;
    },
  };
};

describe("watchDirectory", () => {
  it.effect("emits one event per watcher event, with the joined path", () =>
    Effect.gen(function* () {
      const fake = fakeWatcher();
      const fiber = yield* watchDirectory("/docs", fake.watchFn).pipe(
        Stream.take(3),
        Stream.runCollect,
        Effect.forkChild,
      );

      yield* Effect.yieldNow;
      fake.emit("rename", "a.md");
      fake.emit("rename", "b.md");
      fake.emit("change", "c.md");

      expect(yield* Fiber.join(fiber)).toEqual([
        { path: "/docs/a.md", event: "rename" },
        { path: "/docs/b.md", event: "rename" },
        { path: "/docs/c.md", event: "change" },
      ]);
    }),
  );

  it.effect("maps a null filename to the watched directory without throwing", () =>
    Effect.gen(function* () {
      const fake = fakeWatcher();
      const fiber = yield* watchDirectory("/docs", fake.watchFn).pipe(
        Stream.take(1),
        Stream.runCollect,
        Effect.forkChild,
      );

      yield* Effect.yieldNow;
      fake.emit("change", null);

      expect(yield* Fiber.join(fiber)).toEqual([{ path: "/docs", event: "change" }]);
    }),
  );

  it.effect("closes the underlying watcher when the stream ends", () =>
    Effect.gen(function* () {
      const fake = fakeWatcher();
      const fiber = yield* watchDirectory("/docs", fake.watchFn).pipe(
        Stream.take(1),
        Stream.runCollect,
        Effect.forkChild,
      );

      yield* Effect.yieldNow;
      fake.emit("change", "a.md");
      yield* Fiber.join(fiber);

      expect(fake.closes).toBe(1);
    }),
  );

  it.effect("surfaces a watcher error as WatchError", () =>
    Effect.gen(function* () {
      const fake = fakeWatcher();
      const fiber = yield* watchDirectory("/docs", fake.watchFn).pipe(
        Stream.runCollect,
        Effect.flip,
        Effect.forkChild,
      );

      yield* Effect.yieldNow;
      fake.fail(new Error("emitter failed"));

      const error = yield* Fiber.join(fiber);
      expect(error._tag).toBe("WatchError");
      expect(error.path).toBe("/docs");
      expect(error.reason).toBe("other");
      expect(error.message).toContain("emitter failed");
    }),
  );
});
