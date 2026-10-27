// @effect-diagnostics asyncFunction:off
import { Context, Effect, Layer, Schema } from "effect";
import type { Element, Root } from "hast";

/** The one role set the sheets define and the closure corpus must paint. */
export const ROLES = [
  "keyword",
  "string",
  "number",
  "constant",
  "function",
  "type",
  "variable",
  "comment",
  "operator",
  "punctuation",
  "tag",
  "attribute",
] as const;
export type Role = (typeof ROLES)[number];
export const FALLBACK_ROLE = "foreground" as const;

/** The syntax scopes each role paints; a role value comes from these scopes. */
export const ROLE_SCOPES: Record<Role, readonly string[]> = {
  keyword: ["keyword", "storage.type", "storage.modifier"],
  string: ["string"],
  number: ["constant.numeric"],
  constant: ["constant.language", "constant.character"],
  function: ["entity.name.function", "support.function"],
  type: ["support.type", "entity.name.type"],
  variable: ["variable", "meta.definition.variable"],
  comment: ["comment"],
  operator: ["keyword.operator"],
  punctuation: ["punctuation"],
  tag: ["entity.name.tag"],
  attribute: ["entity.other.attribute-name"],
};

/**
 * One exemplar per role: the code, the grammar, and the token whose colour the
 * source theme paints for that role's scopes. The token is located by offset, so
 * a theme that merges or splits adjacent tokens still reads the same span.
 */
export const ROLE_EXEMPLARS: Record<
  Role,
  { readonly lang: string; readonly code: string; readonly token: string }
> = {
  keyword: { lang: "typescript", code: "const x = 1", token: "const" },
  string: { lang: "typescript", code: 'const s = "hi";', token: "hi" },
  number: { lang: "typescript", code: "const n = 42;", token: "42" },
  constant: { lang: "typescript", code: "const c = true;", token: "true" },
  function: { lang: "typescript", code: "function greet() {}", token: "greet" },
  type: { lang: "typescript", code: 'const t: string = "";', token: "string" },
  variable: { lang: "typescript", code: "const value = 1;", token: "value" },
  comment: { lang: "typescript", code: "// note", token: "// note" },
  operator: { lang: "typescript", code: "const sum = a + b;", token: "+" },
  punctuation: { lang: "json", code: '{"a": 1}', token: "{" },
  tag: { lang: "html", code: "<div>", token: "div" },
  attribute: { lang: "html", code: '<a href="#">', token: "href" },
};

/** The one highlighter theme: every value is a role variable, never a colour. */
export const ROLE_THEME = {
  name: "mdv-roles",
  type: "light" as const,
  colors: {
    "editor.background": "var(--mdv-background)",
    "editor.foreground": "var(--mdv-foreground)",
  },
  tokenColors: ROLES.map((role) => ({
    scope: ROLE_SCOPES[role],
    settings: { foreground: `var(--mdv-token-${role})` },
  })),
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
};

export type HighlightOptions = {
  readonly lang: string;
  readonly theme: string;
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
            theme: ROLE_THEME.name,
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
    themes: [ROLE_THEME as never],
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
        theme: ROLE_THEME.name,
      });
    },
  };
};
