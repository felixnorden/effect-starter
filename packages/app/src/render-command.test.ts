import { layer } from "@effect/vitest";
import { Renderer, RenderError, type DocumentModel } from "@mdv/core";
import { Effect, Layer } from "effect";
import { expect } from "vitest";

import { runRender } from "./render-command.ts";

const document: DocumentModel = {
  title: "Kitchen Sink",
  optionsHash: "0123456789abcdef",
  blocks: [
    {
      kind: "frontMatter",
      range: { startLine: 1, endLine: 4 },
      hash: "aaaaaaaaaaaaaaaa",
      hast: [],
    },
    {
      kind: "heading",
      range: { startLine: 5, endLine: 5 },
      hash: "bbbbbbbbbbbbbbbb",
      hast: [
        {
          type: "element",
          tagName: "h1",
          properties: { id: "kitchen-sink" },
          children: [{ type: "text", value: "Kitchen Sink" }],
        },
      ],
    },
  ],
};

const okLayer = Layer.succeed(Renderer, Renderer.of({ render: () => Effect.succeed(document) }));

const failingError = new RenderError({ stage: "highlight", line: 7, message: "boom" });

const failingLayer = Layer.succeed(
  Renderer,
  Renderer.of({ render: () => Effect.fail(failingError) }),
);

layer(okLayer)("runRender", (tests) => {
  tests.effect("prints title, options hash, block rows, then HTML", () =>
    Effect.gen(function* () {
      const lines: string[] = [];

      yield* runRender({
        file: "a.md",
        write: (line) => lines.push(line),
        readFile: () => Effect.succeed("source"),
      });

      expect(lines[0]).toBe("title: Kitchen Sink");
      expect(lines[1]).toBe("optionsHash: 0123456789abcdef");
      expect(lines[2]).toBe("blocks: 2");

      const headingRow = lines.find((line) => line.includes("heading"));
      expect(headingRow).toContain("5-5");
      expect(headingRow).toContain("bbbbbbbbbbbbbbbb");

      const htmlIndex = lines.indexOf("--- html ---");
      expect(htmlIndex).toBeGreaterThan(3);
      expect(lines[htmlIndex + 1]).toContain('<h1 id="kitchen-sink">');
    }),
  );
});

layer(failingLayer)("runRender with a failing renderer", (tests) => {
  tests.effect("fails with the render error and writes nothing", () =>
    Effect.gen(function* () {
      const lines: string[] = [];

      const error = yield* Effect.flip(
        runRender({
          file: "a.md",
          write: (line) => lines.push(line),
          readFile: () => Effect.succeed("source"),
        }),
      );

      expect(error).toBe(failingError);
      expect(lines).toEqual([]);
    }),
  );
});
