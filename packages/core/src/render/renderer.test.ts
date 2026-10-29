// @effect-diagnostics asyncFunction:off
// @effect-diagnostics strictEffectProvide:off
import { assert, it, layer } from "@effect/vitest";
import { Effect, Layer } from "effect";
import type { Element } from "hast";
import { readFileSync } from "node:fs";
import { describe, expect } from "vitest";

import { collectBlocks, createMarkdownIt } from "./blocks.ts";
import { documentToHtml } from "./to-html.ts";
import { readFrontMatter } from "./front-matter.ts";
import { CodeHighlighting, type HighlighterPort } from "./highlight.ts";
import { defaultRenderOptions, optionsHash } from "./options.ts";
import { Renderer, RenderError } from "./renderer.ts";
import type { DocumentModel } from "./document.ts";

const kitchenSink = readFileSync(
  new URL("../../../../fixtures/kitchen-sink.md", import.meta.url),
  "utf8",
);

const preWithText = (code: string): Element => ({
  type: "element",
  tagName: "pre",
  properties: { className: ["shiki"] },
  children: [
    {
      type: "element",
      tagName: "code",
      properties: {},
      children: [{ type: "text", value: code }],
    },
  ],
});

const stubPort = (overrides: Partial<HighlighterPort> = {}): HighlighterPort => ({
  codeToHast: async (code) => ({ type: "root", children: [preWithText(code)] }),
  getLoadedLanguages: () => ["text"],
  loadLanguage: async () => {},
  ...overrides,
});

const stubLayer = (port: HighlighterPort = stubPort()) =>
  Renderer.layer.pipe(Layer.provide(CodeHighlighting.layerOf(port)));

const preloadState: { loaded: string[]; loads: string[][] } = { loaded: [], loads: [] };
const preloadPort = stubPort({
  getLoadedLanguages: () => preloadState.loaded,
  loadLanguage: async (...langs) => {
    preloadState.loads.push([...langs]);
    preloadState.loaded.push(...langs);
  },
});

const realLayer = Renderer.layer.pipe(Layer.provide(CodeHighlighting.layer));

const render = (source: string, options = defaultRenderOptions) =>
  Effect.gen(function* () {
    const renderer = yield* Renderer;
    return yield* renderer.render(source, options);
  });

const elementsOf = (document: DocumentModel, tagName: string): Element[] => {
  const found: Element[] = [];
  const walk = (nodes: DocumentModel["blocks"][number]["hast"]): void => {
    for (const node of nodes) {
      if (node.type !== "element") continue;
      if (node.tagName === tagName) found.push(node);
      walk(node.children);
    }
  };
  for (const block of document.blocks) walk(block.hast);
  return found;
};

layer(stubLayer())("renderer with a stub highlighter", (tests) => {
  tests.effect("returns one block per top-level block with kind, range, and hash", () =>
    Effect.gen(function* () {
      const document = yield* render(kitchenSink);
      const body = readFrontMatter(kitchenSink)?.body ?? kitchenSink;
      const skeletons = collectBlocks(
        createMarkdownIt(defaultRenderOptions),
        body,
        defaultRenderOptions,
      );
      const lineCount = kitchenSink.split("\n").length;

      assert.strictEqual(document.blocks.length, skeletons.length + 1);
      for (const block of document.blocks) {
        assert.isAtMost(block.range.endLine, lineCount);
        assert.isAtLeast(block.range.startLine, 1);
        assert.match(block.hash, /^[0-9a-f]{16}$/);
      }
    }),
  );

  tests.effect("hides front matter as the first block and uses its title", () =>
    Effect.gen(function* () {
      const source = "---\ntitle: Kitchen Sink\ntags: [a]\n---\n# Heading";
      const document = yield* render(source);

      assert.strictEqual(document.title, "Kitchen Sink");
      assert.strictEqual(document.blocks[0]?.kind, "frontMatter");
      assert.deepStrictEqual(document.blocks[0]?.range, { startLine: 1, endLine: 4 });
    }),
  );

  tests.effect("leaves the title null when there is no front matter", () =>
    Effect.gen(function* () {
      const document = yield* render("# Heading");

      assert.isNull(document.title);
      assert.strictEqual(document.blocks[0]?.kind, "heading");
    }),
  );

  tests.effect("puts the option hash on the document", () =>
    Effect.gen(function* () {
      const document = yield* render(kitchenSink);

      assert.strictEqual(document.optionsHash, optionsHash(defaultRenderOptions));
    }),
  );

  tests.effect("changes only the edited block's hash", () =>
    Effect.gen(function* () {
      const before = yield* render(kitchenSink);
      const after = yield* render(
        kitchenSink.replace("A paragraph with", "A changed paragraph with"),
      );

      assert.strictEqual(after.blocks.length, before.blocks.length);
      const changed = before.blocks.filter(
        (block, index) => block.hash !== after.blocks[index]?.hash,
      );
      assert.strictEqual(changed.length, 1);
      assert.deepStrictEqual(
        after.blocks.map((block) => block.range),
        before.blocks.map((block) => block.range),
      );
    }),
  );

  tests.effect("changes only the TOC and heading blocks when a heading's text changes", () =>
    Effect.gen(function* () {
      const before = yield* render("${toc}\n\nA paragraph.\n\n# Alpha");
      const after = yield* render("${toc}\n\nA paragraph.\n\n# Beta");

      assert.deepStrictEqual(
        after.blocks.map((block) => block.kind),
        before.blocks.map((block) => block.kind),
      );
      assert.notStrictEqual(after.blocks[0]?.hash, before.blocks[0]?.hash);
      assert.strictEqual(after.blocks[1]?.hash, before.blocks[1]?.hash);
      assert.notStrictEqual(after.blocks[2]?.hash, before.blocks[2]?.hash);
    }),
  );

  tests.effect("renders an inline math paragraph with kind paragraph", () =>
    Effect.gen(function* () {
      const document = yield* render("text $E = mc^2$ end");

      assert.strictEqual(document.blocks.length, 1);
      assert.strictEqual(document.blocks[0]?.kind, "paragraph");
      assert.match(document.blocks[0]?.hash ?? "", /^[0-9a-f]{16}$/);
      assert.isAtLeast(elementsOf(document, "math").length, 1);
    }),
  );

  tests.effect("renders a footnote section as one block of kind footnote", () =>
    Effect.gen(function* () {
      const document = yield* render("A[^a].\n\n[^a]: text\n");

      assert.strictEqual(document.blocks.length, 2);
      assert.strictEqual(document.blocks[1]?.kind, "footnote");
      assert.match(document.blocks[1]?.hash ?? "", /^[0-9a-f]{16}$/);
    }),
  );

  tests.effect("sanitizes raw HTML without merging neighbouring blocks", () =>
    Effect.gen(function* () {
      const document = yield* render('<div class="open">\n\nafter');

      assert.strictEqual(document.blocks.length, 2);
      assert.strictEqual(document.blocks[1]?.kind, "paragraph");
      assert.strictEqual(elementsOf(document, "p").length, 1);
    }),
  );

  tests.effect("renders a math block with kind math and a KaTeX subtree", () =>
    Effect.gen(function* () {
      const document = yield* render("$$\nx=1\n$$");

      assert.strictEqual(document.blocks.length, 1);
      assert.strictEqual(document.blocks[0]?.kind, "math");
      assert.match(document.blocks[0]?.hash ?? "", /^[0-9a-f]{16}$/);
      assert.isAtLeast(elementsOf(document, "math").length, 1);
    }),
  );

  tests.effect("sanitizes inline raw HTML inside a paragraph", () =>
    Effect.gen(function* () {
      const document = yield* render('a <script>alert(1)</script> <b onclick="x()">bold</b> c');

      assert.strictEqual(document.blocks.length, 1);
      assert.strictEqual(elementsOf(document, "script").length, 0);
      assert.strictEqual(elementsOf(document, "b").length, 1);
      assert.isUndefined(elementsOf(document, "b")[0]?.properties.onclick);
      assert.strictEqual(documentToHtml(document).includes("bold"), true);
    }),
  );
});

layer(stubLayer(preloadPort))("renderer preload", (tests) => {
  tests.effect("preloads each unique fence language once", () =>
    Effect.gen(function* () {
      preloadState.loaded.length = 0;
      preloadState.loads.length = 0;
      const source = [
        "```ts",
        "a",
        "```",
        "",
        "```json",
        "{}",
        "```",
        "",
        "```ts",
        "b",
        "```",
      ].join("\n");

      const document = yield* render(source);

      expect(preloadState.loads).toEqual([["typescript", "json"]]);
      assert.strictEqual(document.blocks.length, 3);
    }),
  );
});

layer(realLayer)("renderer with the real highlighter", (tests) => {
  tests.effect("falls back to plain text for an unknown fence language", () =>
    Effect.gen(function* () {
      const document = yield* render("```notalang\nplain text fallback\n```");
      const html = documentToHtml(document);

      assert.strictEqual(document.blocks[0]?.kind, "code");
      assert.strictEqual(elementsOf(document, "pre").length, 1);
      assert.include(html, "plain text fallback");
    }),
  );
});

layer(
  stubLayer(
    stubPort({
      codeToHast: async () => {
        throw new Error("boom");
      },
    }),
  ),
)("renderer with a failing highlighter", (tests) => {
  tests.effect("reports a highlighter failure as RenderError with the stage and line", () =>
    Effect.gen(function* () {
      const source = ["one", "", "two", "", "three", "", "```ts", "x", "```"].join("\n");
      const error = yield* Effect.flip(render(source));

      assert.instanceOf(error, RenderError);
      assert.strictEqual(error.stage, "highlight");
      assert.strictEqual(error.line, 7);
      assert.isAbove(error.message.length, 0);
    }),
  );
});

describe("kitchen-sink snapshot", () => {
  it("pins the blocks and the rendered HTML", async () => {
    const document = await Effect.runPromise(render(kitchenSink).pipe(Effect.provide(realLayer)));

    expect(document.blocks).toMatchSnapshot();
    await expect(documentToHtml(document)).toMatchFileSnapshot("__snapshots__/kitchen-sink.html");
  });
});
