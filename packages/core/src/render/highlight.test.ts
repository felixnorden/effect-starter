// @effect-diagnostics asyncFunction:off
// @effect-diagnostics strictEffectProvide:off
import { it } from "@effect/vitest";
import { Effect } from "effect";
import type { Element, Root } from "hast";
import { toHtml } from "hast-util-to-html";
import { describe, expect } from "vitest";

import {
  CODE_THEMES,
  CodeHighlighting,
  HighlightError,
  type HighlighterPort,
  type HighlightOptions,
} from "./highlight.ts";

const preElement = (): Element => ({
  type: "element",
  tagName: "pre",
  properties: {},
  children: [],
});

type Call = { readonly method: string; readonly args: readonly unknown[] };

const stubHighlighter = (overrides: Partial<HighlighterPort> = {}) => {
  const calls: Call[] = [];
  const port: HighlighterPort = {
    codeToHast: async (code, options) => {
      calls.push({ method: "codeToHast", args: [code, options] });
      const root: Root = { type: "root", children: [preElement()] };
      return root;
    },
    getLoadedLanguages: () => [],
    loadLanguage: async (lang) => {
      calls.push({ method: "loadLanguage", args: [lang] });
    },
    ...overrides,
  };
  return { port, calls };
};

const run = (
  port: HighlighterPort,
  request: Parameters<CodeHighlighting["Service"]["highlight"]>[0],
) =>
  Effect.gen(function* () {
    const highlighting = yield* CodeHighlighting;
    return yield* highlighting.highlight(request);
  }).pipe(Effect.provide(CodeHighlighting.layerOf(port)));

const codeToHastOptions = (calls: readonly Call[]): HighlightOptions | undefined =>
  calls.find((call) => call.method === "codeToHast")?.args[1] as HighlightOptions | undefined;

describe("CodeHighlighting", () => {
  it.effect("highlights with the high-contrast palettes", () =>
    Effect.gen(function* () {
      const { port, calls } = stubHighlighter({ getLoadedLanguages: () => ["typescript"] });

      yield* run(port, { code: "const x = 1;", lang: "typescript", codeThemes: CODE_THEMES });

      expect(CODE_THEMES).toEqual({
        light: "github-light-high-contrast",
        dark: "github-dark-high-contrast",
      });
      expect(codeToHastOptions(calls)?.themes).toEqual(CODE_THEMES);
    }),
  );

  it.effect("resolves both themes through their explicit loaders", () =>
    Effect.gen(function* () {
      const highlighting = yield* CodeHighlighting;
      const pre = yield* highlighting.highlight({
        code: "const x = 1;",
        lang: "typescript",
        codeThemes: CODE_THEMES,
      });
      const html = toHtml(pre);

      expect(html).toContain("github-light-high-contrast");
      expect(html).toContain("github-dark-high-contrast");
    }).pipe(Effect.provide(CodeHighlighting.layer)),
  );

  it.effect("returns the highlighter's pre subtree for a loaded language", () =>
    Effect.gen(function* () {
      const { port, calls } = stubHighlighter({ getLoadedLanguages: () => ["typescript"] });

      const result = yield* run(port, {
        code: "const x = 1;",
        lang: "typescript",
        codeThemes: CODE_THEMES,
      });

      expect(result.tagName).toBe("pre");
      expect(codeToHastOptions(calls)).toMatchObject({
        themes: CODE_THEMES,
        defaultColor: false,
      });
    }),
  );

  it.effect("asks for the text grammar when the language is unknown", () =>
    Effect.gen(function* () {
      const { port, calls } = stubHighlighter({ getLoadedLanguages: () => ["typescript"] });

      yield* run(port, { code: "x", lang: "notalang", codeThemes: CODE_THEMES });

      expect(codeToHastOptions(calls)?.lang).toBe("text");
    }),
  );

  it.effect("asks for the text grammar when there is no language", () =>
    Effect.gen(function* () {
      const { port, calls } = stubHighlighter({ getLoadedLanguages: () => ["typescript"] });

      yield* run(port, { code: "x", lang: null, codeThemes: CODE_THEMES });

      expect(codeToHastOptions(calls)?.lang).toBe("text");
    }),
  );

  it.effect("loads an allowlisted grammar before highlighting", () =>
    Effect.gen(function* () {
      const { port, calls } = stubHighlighter({ getLoadedLanguages: () => [] });

      const result = yield* run(port, {
        code: "fn main() {}",
        lang: "rust",
        codeThemes: CODE_THEMES,
      });

      expect(calls.map((call) => call.method)).toEqual(["loadLanguage", "codeToHast"]);
      expect(calls[0]?.args[0]).toBe("rust");
      expect(result.tagName).toBe("pre");
    }),
  );

  it.effect("maps a grammar load failure to HighlightError", () =>
    Effect.gen(function* () {
      const { port } = stubHighlighter({
        getLoadedLanguages: () => [],
        loadLanguage: async () => {
          throw new Error("unavailable");
        },
      });

      const error = yield* Effect.flip(
        run(port, { code: "x", lang: "rust", codeThemes: CODE_THEMES }),
      );

      expect(error).toBeInstanceOf(HighlightError);
      expect(error.message).toContain("unavailable");
    }),
  );

  it.effect("maps a highlighter failure to HighlightError", () =>
    Effect.gen(function* () {
      const { port } = stubHighlighter({
        getLoadedLanguages: () => ["typescript"],
        codeToHast: async () => {
          throw new Error("boom");
        },
      });

      const error = yield* Effect.flip(
        run(port, { code: "x", lang: "typescript", codeThemes: CODE_THEMES }),
      );

      expect(error).toBeInstanceOf(HighlightError);
      expect(error.message).toContain("boom");
    }),
  );
});
