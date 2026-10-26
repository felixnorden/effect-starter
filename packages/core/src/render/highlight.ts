// @effect-diagnostics asyncFunction:off
import { Context, Effect, Layer, Schema } from "effect";
import type { Element, Root } from "hast";

/** Shiki themes are constants: a theme switch is CSS-only and changes no hash. */
export type CodeThemes = {
  readonly light: string;
  readonly dark: string;
};

export const CODE_THEMES: CodeThemes = {
  light: "github-light-high-contrast",
  dark: "github-dark-high-contrast",
};

export class HighlightError extends Schema.TaggedError<
  HighlightError,
  { readonly brand: unique symbol }
>()("HighlightError", {
  message: Schema.String,
}) {}

export type HighlightRequest = {
  readonly code: string;
  readonly lang: string | null;
  readonly codeThemes: CodeThemes;
};

export type HighlightOptions = {
  readonly lang: string;
  readonly themes: CodeThemes;
  readonly defaultColor: false;
};

/**
 * The narrow port. Keeping Shiki's full `Highlighter` out of the service
 * contract keeps the test double three short methods.
 */
export type HighlighterPort = {
  readonly codeToHast: (code: string, options: HighlightOptions) => Promise<Root>;
  readonly getLoadedLanguages: () => readonly string[];
  readonly loadLanguage: (lang: string) => Promise<void>;
};

type GrammarKey =
  | "typescript"
  | "tsx"
  | "javascript"
  | "jsx"
  | "json"
  | "bash"
  | "markdown"
  | "yaml"
  | "html"
  | "css"
  | "python"
  | "rust"
  | "go"
  | "sql"
  | "diff"
  | "dockerfile";

/** Only the bundled grammars are loadable; anything else is plain text. */
const GRAMMARS: Record<GrammarKey, () => Promise<unknown>> = {
  typescript: () => import("shiki/langs/typescript.mjs"),
  tsx: () => import("shiki/langs/tsx.mjs"),
  javascript: () => import("shiki/langs/javascript.mjs"),
  jsx: () => import("shiki/langs/jsx.mjs"),
  json: () => import("shiki/langs/json.mjs"),
  bash: () => import("shiki/langs/bash.mjs"),
  markdown: () => import("shiki/langs/markdown.mjs"),
  yaml: () => import("shiki/langs/yaml.mjs"),
  html: () => import("shiki/langs/html.mjs"),
  css: () => import("shiki/langs/css.mjs"),
  python: () => import("shiki/langs/python.mjs"),
  rust: () => import("shiki/langs/rust.mjs"),
  go: () => import("shiki/langs/go.mjs"),
  sql: () => import("shiki/langs/sql.mjs"),
  diff: () => import("shiki/langs/diff.mjs"),
  dockerfile: () => import("shiki/langs/dockerfile.mjs"),
};

const ALIASES: Record<string, GrammarKey> = {
  typescript: "typescript",
  ts: "typescript",
  tsx: "tsx",
  javascript: "javascript",
  js: "javascript",
  jsx: "jsx",
  json: "json",
  bash: "bash",
  sh: "bash",
  shell: "bash",
  markdown: "markdown",
  md: "markdown",
  yaml: "yaml",
  yml: "yaml",
  html: "html",
  css: "css",
  python: "python",
  rust: "rust",
  go: "go",
  sql: "sql",
  diff: "diff",
  dockerfile: "dockerfile",
};

const TEXT = "text";

const resolveGrammar = (lang: string | null): GrammarKey | typeof TEXT => {
  if (lang === null) return TEXT;
  return ALIASES[lang.toLowerCase()] ?? TEXT;
};

const describeCause = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

const findPre = (root: Root): Element | null => {
  for (const node of root.children) {
    if (node.type === "element" && node.tagName === "pre") return node;
  }
  return null;
};

/**
 * Highlighting is core's one I/O site: it dynamically imports bundled grammars
 * and themes on the JavaScript regex engine.
 */
export class CodeHighlighting extends Context.Service<
  CodeHighlighting,
  {
    readonly highlight: (request: HighlightRequest) => Effect.Effect<Element, HighlightError>;
  }
>()("@mdv/core/CodeHighlighting") {
  static readonly layer: Layer.Layer<CodeHighlighting> = Layer.unwrap(
    Effect.promise(async () => CodeHighlighting.layerOf(await createRealHighlighter())),
  );

  static readonly layerOf = (highlighter: HighlighterPort): Layer.Layer<CodeHighlighting> => {
    const highlight = Effect.fn("CodeHighlighting.highlight")(function* (
      request: HighlightRequest,
    ) {
      const grammar = resolveGrammar(request.lang);

      if (grammar !== TEXT && !highlighter.getLoadedLanguages().includes(grammar)) {
        yield* Effect.tryPromise({
          try: () => highlighter.loadLanguage(grammar),
          catch: (cause) =>
            new HighlightError({
              message: `failed to load grammar ${grammar}: ${describeCause(cause)}`,
            }),
        });
      }

      const root = yield* Effect.tryPromise({
        try: () =>
          highlighter.codeToHast(request.code, {
            lang: grammar,
            themes: request.codeThemes,
            defaultColor: false,
          }),
        catch: (cause) =>
          new HighlightError({ message: `failed to highlight: ${describeCause(cause)}` }),
      });

      const pre = findPre(root);
      if (pre === null) {
        return yield* new HighlightError({ message: "highlighter returned no pre element" });
      }
      return pre;
    });

    return Layer.succeed(CodeHighlighting, CodeHighlighting.of({ highlight }));
  };
}

const createRealHighlighter = async (): Promise<HighlighterPort> => {
  const [{ createHighlighterCore }, { createJavaScriptRegexEngine }] = await Promise.all([
    import("shiki/core"),
    import("shiki/engine/javascript"),
  ]);

  const highlighter = await createHighlighterCore({
    themes: [
      import("shiki/themes/github-light-high-contrast.mjs"),
      import("shiki/themes/github-dark-high-contrast.mjs"),
    ],
    langs: [],
    engine: createJavaScriptRegexEngine(),
  });

  return {
    codeToHast: async (code, options) => highlighter.codeToHast(code, options),
    getLoadedLanguages: () => highlighter.getLoadedLanguages(),
    loadLanguage: async (lang) => {
      const load = GRAMMARS[lang as GrammarKey];
      if (load === undefined) return;
      await highlighter.loadLanguage((await load()) as never);
      // The JavaScript regex engine resolves scopes differently on the first
      // tokenization after a load. One throwaway pass pins the stable output,
      // so a block hash cannot change without a content change.
      highlighter.codeToHast("x", {
        lang,
        themes: CODE_THEMES,
        defaultColor: false,
      });
    },
  };
};
