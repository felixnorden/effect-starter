import { it } from "@effect/vitest";
import { Cause, Effect, Fiber, Queue, Ref, Stream } from "effect";
import { TestClock } from "effect/testing";
import { describe, expect } from "vitest";

import { coalesce } from "./coalesce.ts";
import { WatchError, type SaveEvent } from "./watch.ts";

const event: SaveEvent = { path: "/docs/a.md", event: "change" };

const missingError = new WatchError({
  path: "/docs/a.md",
  reason: "missing",
  message: "gone",
});

const permissionError = new WatchError({
  path: "/docs/a.md",
  reason: "permission",
  message: "denied",
});

describe("coalesce", () => {
  it.effect("collapses a burst inside one window into one read", () =>
    Effect.gen(function* () {
      const reads = yield* Ref.make(0);
      const read = () =>
        Effect.gen(function* () {
          yield* Ref.update(reads, (value) => value + 1);
          return { source: "x", contentHash: "h" };
        });

      const fiber = yield* coalesce(
        Stream.fromIterable([event, event, event, event, event]),
        read,
      ).pipe(Stream.take(1), Stream.runCollect, Effect.forkChild);

      yield* Effect.yieldNow;
      yield* TestClock.adjust("50 millis");

      const result = yield* Fiber.join(fiber);
      expect(result).toHaveLength(1);
      expect(yield* Ref.get(reads)).toBe(1);
    }),
  );

  it.effect("reads again for an event in a later window", () =>
    Effect.gen(function* () {
      const input = yield* Queue.unbounded<SaveEvent>();
      const reads = yield* Ref.make(0);
      const read = () =>
        Effect.gen(function* () {
          const count = yield* Ref.updateAndGet(reads, (value) => value + 1);
          return { source: `s${count}`, contentHash: `h${count}` };
        });

      const fiber = yield* coalesce(Stream.fromQueue(input), read).pipe(
        Stream.take(2),
        Stream.runCollect,
        Effect.forkChild,
      );

      yield* Queue.offer(input, event);
      yield* TestClock.adjust("40 millis");
      yield* Queue.offer(input, event);
      yield* TestClock.adjust("40 millis");

      const result = yield* Fiber.join(fiber);
      expect(result).toHaveLength(2);
      expect(yield* Ref.get(reads)).toBe(2);
    }),
  );

  it.effect("emits nothing when the content hash did not change", () =>
    Effect.gen(function* () {
      const input = yield* Queue.unbounded<SaveEvent, Cause.Done>();
      const reads = yield* Ref.make(0);
      const read = () =>
        Effect.gen(function* () {
          yield* Ref.update(reads, (value) => value + 1);
          return { source: "x", contentHash: "same" };
        });

      const fiber = yield* coalesce(Stream.fromQueue(input), read).pipe(
        Stream.runCollect,
        Effect.forkChild,
      );

      yield* Queue.offer(input, event);
      yield* TestClock.adjust("40 millis");
      yield* Queue.offer(input, event);
      yield* TestClock.adjust("40 millis");
      yield* Queue.end(input);
      yield* TestClock.adjust("40 millis");

      const result = yield* Fiber.join(fiber);
      expect(result).toHaveLength(1);
    }),
  );

  it.effect("treats ENOENT as no emission and keeps the stream alive", () =>
    Effect.gen(function* () {
      const input = yield* Queue.unbounded<SaveEvent>();
      const calls = yield* Ref.make(0);
      const read = () =>
        Effect.gen(function* () {
          const call = yield* Ref.updateAndGet(calls, (value) => value + 1);
          if (call === 1) return yield* missingError;
          return { source: "x", contentHash: "h" };
        });

      const fiber = yield* coalesce(Stream.fromQueue(input), read).pipe(
        Stream.take(1),
        Stream.runCollect,
        Effect.forkChild,
      );

      yield* Queue.offer(input, event);
      yield* TestClock.adjust("40 millis");
      yield* Queue.offer(input, event);
      yield* TestClock.adjust("40 millis");

      const result = yield* Fiber.join(fiber);
      expect(result).toHaveLength(1);
      expect(yield* Ref.get(calls)).toBe(2);
    }),
  );

  it.effect("emits a read error and keeps going for other failures", () =>
    Effect.gen(function* () {
      const input = yield* Queue.unbounded<SaveEvent>();
      const calls = yield* Ref.make(0);
      const read = () =>
        Effect.gen(function* () {
          const call = yield* Ref.updateAndGet(calls, (value) => value + 1);
          if (call === 1) return yield* permissionError;
          return { source: "x", contentHash: "h" };
        });

      const fiber = yield* coalesce(Stream.fromQueue(input), read).pipe(
        Stream.take(2),
        Stream.runCollect,
        Effect.forkChild,
      );

      yield* Queue.offer(input, event);
      yield* TestClock.adjust("40 millis");
      yield* Queue.offer(input, event);
      yield* TestClock.adjust("40 millis");

      const result = yield* Fiber.join(fiber);
      expect(result.map((entry) => entry._tag)).toEqual(["readError", "source"]);
    }),
  );

  it.effect("keeps at most one pending read and lets the newest content win", () =>
    Effect.gen(function* () {
      const input = yield* Queue.unbounded<SaveEvent>();
      const calls = yield* Ref.make(0);
      const read = () =>
        Effect.gen(function* () {
          const call = yield* Ref.updateAndGet(calls, (value) => value + 1);
          yield* Effect.sleep("100 millis");
          return { source: `s${call}`, contentHash: `h${call}` };
        });

      const fiber = yield* coalesce(Stream.fromQueue(input), read).pipe(
        Stream.take(2),
        Stream.runCollect,
        Effect.forkChild,
      );

      yield* Queue.offer(input, event);
      yield* TestClock.adjust("40 millis");
      yield* Queue.offer(input, event);
      yield* Queue.offer(input, event);
      yield* Queue.offer(input, event);
      yield* TestClock.adjust("100 millis");
      yield* TestClock.adjust("40 millis");
      yield* TestClock.adjust("150 millis");

      const result = yield* Fiber.join(fiber);
      expect(yield* Ref.get(calls)).toBe(2);
      expect(result.map((entry) => entry._tag === "source" && entry.snapshot.source)).toEqual([
        "s1",
        "s2",
      ]);
    }),
  );

  it.effect("stops reading after the stream ends", () =>
    Effect.gen(function* () {
      const reads = yield* Ref.make(0);
      const read = () =>
        Effect.gen(function* () {
          yield* Ref.update(reads, (value) => value + 1);
          return { source: "x", contentHash: `h${yield* Ref.get(reads)}` };
        });

      const fiber = yield* coalesce(Stream.fromIterable([event]), read).pipe(
        Stream.runCollect,
        Effect.forkChild,
      );

      yield* Effect.yieldNow;
      yield* TestClock.adjust("40 millis");
      yield* TestClock.adjust("40 millis");

      const result = yield* Fiber.join(fiber);
      expect(result).toHaveLength(1);
      expect(yield* Ref.get(reads)).toBe(1);
    }),
  );
});
