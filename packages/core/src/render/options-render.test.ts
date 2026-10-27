// @effect-diagnostics asyncFunction:off
// @effect-diagnostics strictEffectProvide:off
import { Effect, Layer } from "effect";
import type { Element } from "hast";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import type { DocumentModel } from "./document.ts";
import { CodeHighlighting, type HighlighterPort } from "./highlight.ts";
import { defaultRenderOptions, optionsHash, type RenderOptions } from "./options.ts";
import { Renderer } from "./renderer.ts";
import { documentToHtml } from "./to-html.ts";

const fixtureOf = (name: string): string =>
  readFileSync(new URL(`../../../../fixtures/render-fidelity/${name}.md`, import.meta.url), "utf8");

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

const stubPort: HighlighterPort = {
  codeToHast: async (code) => ({ type: "root", children: [preWithText(code)] }),
  getLoadedLanguages: () => ["text"],
  loadLanguage: async () => {},
};

const layer = Renderer.layer.pipe(Layer.provide(CodeHighlighting.layerOf(stubPort)));

const render = (source: string, options: RenderOptions = defaultRenderOptions) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const renderer = yield* Renderer;
      return yield* renderer.render(source, options);
    }).pipe(Effect.provide(layer)),
  );

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

describe("option markup", () => {
  it("changes markup when html changes", async () => {
    const source = fixtureOf("options-html");
    const off = documentToHtml(await render(source, { ...defaultRenderOptions, html: false }));
    const on = documentToHtml(await render(source));

    expect(off).toContain('&#x3C;div class="box">raw block&#x3C;/div>');
    expect(off).toContain("&#x3C;b>bold&#x3C;/b>");
    expect(on).toContain("<div>raw block</div>");
    expect(on).toContain("<b>bold</b>");
    expect({ off, on }).toMatchSnapshot();
  });

  it("changes markup when linkify changes", async () => {
    const source = fixtureOf("options-linkify");
    const off = documentToHtml(await render(source, { ...defaultRenderOptions, linkify: false }));
    const on = documentToHtml(await render(source));

    expect(off).not.toContain("<a");
    expect(on).toContain('<a href="https://example.com/path">');
    expect({ off, on }).toMatchSnapshot();
  });

  it("changes markup when breaks changes", async () => {
    const source = fixtureOf("options-breaks");
    const off = documentToHtml(await render(source, { ...defaultRenderOptions, breaks: false }));
    const on = documentToHtml(await render(source, { ...defaultRenderOptions, breaks: true }));

    expect(off).not.toContain("A soft break ends this line.<br>");
    expect(on).toContain("A soft break ends this line.<br>");
    expect({ off, on }).toMatchSnapshot();
  });
});

describe("typographer and quotes", () => {
  it("renders typographic replacements only when typographer is on", async () => {
    const source = fixtureOf("options-typographer");
    const off = documentToHtml(
      await render(source, { ...defaultRenderOptions, typographer: false }),
    );
    const on = documentToHtml(await render(source, { ...defaultRenderOptions, typographer: true }));

    for (const literal of ["--", "---", "...", "(c)", '"', "'"]) expect(off).toContain(literal);
    for (const replaced of ["–", "—", "…", "©", "“", "”", "‘", "’"]) expect(on).toContain(replaced);
    expect({ off, on }).toMatchSnapshot();
  });

  it("maps all to the four characters and any four-unit value verbatim", async () => {
    const source = fixtureOf("options-quotes");
    const all = documentToHtml(
      await render(source, { ...defaultRenderOptions, typographer: true, quotes: "all" }),
    );
    const custom = documentToHtml(
      await render(source, { ...defaultRenderOptions, typographer: true, quotes: "«»„‚" }),
    );

    expect(all).toContain("“Double quotes”");
    expect(all).toContain("‘single quotes’");
    expect(custom).toContain("«Double quotes»");
    expect(custom).toContain("„single quotes‚");
    expect({ all, custom }).toMatchSnapshot();
  });

  it("leaves quotes inert while typographer is off", async () => {
    const source = fixtureOf("options-quotes");
    const all = await render(source, { ...defaultRenderOptions, quotes: "all" });
    const custom = await render(source, { ...defaultRenderOptions, quotes: "«»„‚" });

    expect(documentToHtml(custom)).toBe(documentToHtml(all));
    // The markup is inert, but `quotes` stays in the salt, so hashes differ by
    // construction. A quotes-only change is therefore a snapshot, by design.
    expect(custom.blocks.map((block) => block.hash)).not.toEqual(
      all.blocks.map((block) => block.hash),
    );
  });
});

describe("fallback fence and xhtmlOut", () => {
  it("applies langPrefix on the fallback fence only", async () => {
    const source = fixtureOf("options-langprefix");
    const language = await render(source, { ...defaultRenderOptions, langPrefix: "language-" });
    const lang = await render(source, { ...defaultRenderOptions, langPrefix: "lang-" });

    const languageCode = elementsOf(language, "code").filter(
      (element) => element.properties.className !== undefined,
    );
    const langCode = elementsOf(lang, "code").filter(
      (element) => element.properties.className !== undefined,
    );
    expect(languageCode).toHaveLength(1);
    expect(langCode).toHaveLength(1);
    expect(languageCode[0]?.properties.className).toEqual(["language-ts"]);
    expect(langCode[0]?.properties.className).toEqual(["lang-ts"]);

    for (const document of [language, lang]) {
      const pres = elementsOf(document, "pre");
      expect(pres).toHaveLength(2);
      expect(pres[0]?.properties.className).toBeUndefined();
      expect(pres[1]?.properties.className).toEqual(["shiki"]);
    }
  });

  it("renders identical markup and identical hashes for both xhtmlOut values", async () => {
    const source = fixtureOf("options-xhtml-out");
    const off = await render(source, { ...defaultRenderOptions, xhtmlOut: false });
    const on = await render(source, { ...defaultRenderOptions, xhtmlOut: true });

    // markdown-it emits `<br />`/`<hr />` when `xhtmlOut` is true, and the
    // equality holds because every inline fragment is re-parsed into HAST and
    // re-serialised before it is hashed.
    expect(documentToHtml(on)).toBe(documentToHtml(off));
    expect(on.blocks.map((block) => block.hash)).toEqual(off.blocks.map((block) => block.hash));
    expect(on.optionsHash).toBe(optionsHash({ ...defaultRenderOptions, xhtmlOut: true }));
    expect(on.optionsHash).toBe(off.optionsHash);
  });
});
