import { ensureClientBuild, preparePreview } from "./lifecycle.ts";
import { RenderError } from "@mdv/core";
import { Effect } from "effect";
import { it } from "@effect/vitest";
import { describe, expect } from "vitest";

describe("ensureClientBuild", () => {
  it.effect("builds once when index.html is missing", () =>
    Effect.gen(function* () {
      const calls: string[] = [];

      yield* ensureClientBuild({
        exists: () => {
          calls.push("exists");
          return false;
        },
        build: () =>
          Effect.sync(() => {
            calls.push("build");
          }),
      });

      expect(calls).toEqual(["exists", "build"]);
    }),
  );

  it.effect("does not build when index.html exists", () =>
    Effect.gen(function* () {
      const calls: string[] = [];

      yield* ensureClientBuild({
        exists: () => {
          calls.push("exists");
          return true;
        },
        build: () =>
          Effect.sync(() => {
            calls.push("build");
          }),
      });

      expect(calls).toEqual(["exists"]);
    }),
  );
});

describe("preparePreview", () => {
  it.effect("fails before binding when the startup render fails", () =>
    Effect.gen(function* () {
      const calls: string[] = [];
      const renderError = new RenderError({ stage: "parse", line: 1, message: "boom" });

      const error = yield* Effect.flip(
        preparePreview({
          render: () => {
            calls.push("render");
            return Effect.fail(renderError);
          },
          ensureClient: Effect.sync(() => {
            calls.push("build");
          }),
          start: () => {
            calls.push("start");
            return Effect.succeed("handle");
          },
        }),
      );

      expect(error).toBe(renderError);
      expect(calls).toEqual(["render"]);
    }),
  );

  it.effect("builds then starts when the render succeeds", () =>
    Effect.gen(function* () {
      const calls: string[] = [];

      const handle = yield* preparePreview({
        render: () =>
          Effect.sync(() => {
            calls.push("render");
          }),
        ensureClient: Effect.sync(() => {
          calls.push("build");
        }),
        start: () => {
          calls.push("start");
          return Effect.succeed("handle");
        },
      });

      expect(handle).toBe("handle");
      expect(calls).toEqual(["render", "build", "start"]);
    }),
  );
});
