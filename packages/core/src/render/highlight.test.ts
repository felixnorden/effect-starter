// @effect-diagnostics asyncFunction:off
// @effect-diagnostics strictEffectProvide:off
import { it } from "@effect/vitest";
import { Effect } from "effect";
import { createHighlighterCore } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import type { Element, Root } from "hast";
import { toHtml } from "hast-util-to-html";
import { describe, expect } from "vitest";

import {
  CodeHighlighting,
  FALLBACK_ROLE,
  HighlightError,
  ROLES,
  ROLE_EXEMPLARS,
  ROLE_SCOPES,
  ROLE_THEME,
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
  it.effect("requests no theme, only the role theme", () =>
    Effect.gen(function* () {
      const { port, calls } = stubHighlighter({ getLoadedLanguages: () => ["typescript"] });

      yield* run(port, { code: "const x = 1;", lang: "typescript" });

      const options = codeToHastOptions(calls);
      expect(options?.theme).toBe(ROLE_THEME.name);
      expect(options).not.toHaveProperty("themes");
      expect(options).not.toHaveProperty("codeThemes");
    }),
  );

  it.effect("paints tokens with role variables", () =>
    Effect.gen(function* () {
      const highlighting = yield* CodeHighlighting;
      const pre = yield* highlighting.highlight({
        code: 'const s = "hi"; // c\nconst n = 42;',
        lang: "typescript",
      });
      const html = toHtml(pre);

      for (const role of ["keyword", "string", "comment", "number"]) {
        expect(html).toContain(`color:var(--mdv-token-${role})`);
      }
      expect(html).not.toMatch(/#[0-9a-f]{3,8}\b/iu);
    }).pipe(Effect.provide(CodeHighlighting.layer)),
  );

  it.effect("falls back to the foreground role for an uncovered token", () =>
    Effect.gen(function* () {
      const highlighting = yield* CodeHighlighting;
      const pre = yield* highlighting.highlight({ code: "plain text", lang: null });

      expect(toHtml(pre)).toContain("color:var(--mdv-foreground)");
    }).pipe(Effect.provide(CodeHighlighting.layer)),
  );

  it.effect("names no theme in the class", () =>
    Effect.gen(function* () {
      const highlighting = yield* CodeHighlighting;

      for (const code of ["const x = 1;", "let y = 2;"]) {
        const pre = yield* highlighting.highlight({ code, lang: "typescript" });
        expect(toHtml(pre)).toContain('class="shiki mdv-roles"');
      }
    }).pipe(Effect.provide(CodeHighlighting.layer)),
  );

  it.effect("returns the highlighter's pre subtree for a loaded language", () =>
    Effect.gen(function* () {
      const { port, calls } = stubHighlighter({ getLoadedLanguages: () => ["typescript"] });

      const result = yield* run(port, { code: "const x = 1;", lang: "typescript" });

      expect(result.tagName).toBe("pre");
      expect(codeToHastOptions(calls)).toMatchObject({ theme: ROLE_THEME.name });
    }),
  );

  it.effect("asks for the text grammar when the language is unknown", () =>
    Effect.gen(function* () {
      const { port, calls } = stubHighlighter({ getLoadedLanguages: () => ["typescript"] });

      yield* run(port, { code: "x", lang: "notalang" });

      expect(codeToHastOptions(calls)?.lang).toBe("text");
    }),
  );

  it.effect("asks for the text grammar when there is no language", () =>
    Effect.gen(function* () {
      const { port, calls } = stubHighlighter({ getLoadedLanguages: () => ["typescript"] });

      yield* run(port, { code: "x", lang: null });

      expect(codeToHastOptions(calls)?.lang).toBe("text");
    }),
  );

  it.effect("loads an allowlisted grammar before highlighting", () =>
    Effect.gen(function* () {
      const { port, calls } = stubHighlighter({ getLoadedLanguages: () => [] });

      const result = yield* run(port, { code: "fn main() {}", lang: "rust" });

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

      const error = yield* Effect.flip(run(port, { code: "x", lang: "rust" }));

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

      const error = yield* Effect.flip(run(port, { code: "x", lang: "typescript" }));

      expect(error).toBeInstanceOf(HighlightError);
      expect(error.message).toContain("boom");
    }),
  );
});

describe("role contract", () => {
  it("exposes a role map, a fallback, and one exemplar per role", () => {
    expect(FALLBACK_ROLE).toBe("foreground");

    for (const role of ROLES) {
      const exemplar = ROLE_EXEMPLARS[role];
      expect(exemplar.code).toContain(exemplar.token);
      expect(exemplar.lang.length).toBeGreaterThan(0);
      expect(ROLE_SCOPES[role].length).toBeGreaterThan(0);
    }
  });

  it("paints the role markup for a role theme", async () => {
    const highlighter = await createHighlighterCore({
      themes: [ROLE_THEME as never],
      langs: [],
      engine: createJavaScriptRegexEngine(),
    });
    const grammar = await import("shiki/langs/typescript.mjs");
    await highlighter.loadLanguage(grammar.default);

    const html = highlighter.codeToHtml("const x = 1; // c", {
      lang: "typescript",
      theme: ROLE_THEME.name,
    });

    expect(html).toContain("color:var(--mdv-token-keyword)");
    expect(html).toContain("background-color:var(--mdv-background)");
    expect(html).toContain("color:var(--mdv-foreground)");
  });
});
