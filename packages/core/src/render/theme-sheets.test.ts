// @effect-diagnostics asyncFunction:off
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createHighlighterCore } from "shiki/core";
import { createOnigurumaEngine } from "shiki/engine/oniguruma";
import { bundledThemes, bundledThemesInfo } from "shiki/themes";

import { contrastRatio } from "../../../../packages/app/src/contrast.ts";
import { ROLE_EXEMPLARS, ROLES, ROLE_SCOPES, ROLE_THEME, type Role } from "./highlight.ts";
import {
  BACKGROUND_VARIABLE,
  declarationMismatches,
  FOREGROUND_VARIABLE,
  roleValuesFrom,
  ROLE_VARIABLE_PREFIX,
  sheetDeclarations,
  type Sheet,
} from "./theme-sheets.ts";

const SHEET_DIR = new URL(
  "../../../../packages/app/src/client/public/theme-sheets/",
  import.meta.url,
);
const FIXTURES = new URL("../../../../fixtures/", import.meta.url);
const LIMIT = 4.5;
/** One pre foreground per highlighted fence, plus every unpainted token. */
const RECORDED_FOREGROUND_FALLBACKS = 42;

const matchesScope = (scope: string, target: string): boolean =>
  scope === target || scope.startsWith(`${target}.`);

const parseSheet = (file: string): Record<string, string> => {
  const css = readFileSync(new URL(file, SHEET_DIR), "utf8");
  const body = css.slice(css.indexOf("{") + 1, css.lastIndexOf("}"));
  return Object.fromEntries(
    [...body.matchAll(/(--[a-z-]+):\s*([^;]+);/gu)].map((match) => [match[1], match[2]?.trim()]),
  );
};

type Token = {
  readonly content: string;
  readonly offset: number;
  readonly color?: string;
  readonly explanation?: readonly {
    readonly scopes: readonly { readonly scopeName: string }[];
  }[];
};

const highlighter = await createHighlighterCore({
  themes: [],
  langs: [],
  engine: await createOnigurumaEngine(import("shiki/wasm")),
});

for (const lang of new Set(Object.values(ROLE_EXEMPLARS).map((exemplar) => exemplar.lang))) {
  const grammar = await import(`shiki/langs/${lang}.mjs`);
  await highlighter.loadLanguage(grammar.default);
}

/** The same rule as the generator, written again from the source theme. */
const derive = async (id: string): Promise<Sheet> => {
  const theme = (await bundledThemes[id as keyof typeof bundledThemes]()).default;
  await highlighter.loadTheme(theme);

  const background = theme.colors?.["editor.background"] ?? "#ffffff";
  const foreground = theme.colors?.["editor.foreground"] ?? "#000000";
  const values = {} as Record<Role, string>;

  for (const role of ROLES) {
    const exemplar = ROLE_EXEMPLARS[role];
    const result = highlighter.codeToTokens(exemplar.code, {
      lang: exemplar.lang,
      theme: id,
      includeExplanation: true,
    }) as { tokens: Token[][] };
    const index = exemplar.code.indexOf(exemplar.token);
    const token = result.tokens
      .flat()
      .find(
        (candidate) =>
          index >= candidate.offset && index < candidate.offset + candidate.content.length,
      );
    if (token === undefined) {
      throw new Error(`${id} ${role}: no token at ${exemplar.token}`);
    }

    const scopes = (token.explanation ?? []).flatMap((entry) =>
      entry.scopes.map((scope) => scope.scopeName),
    );
    const paintsRole = ROLE_SCOPES[role].some((target) =>
      scopes.some((scope) => matchesScope(scope, target)),
    );
    if (!paintsRole) {
      throw new Error(`${id} ${role}: exemplar is not painted by ${ROLE_SCOPES[role].join(", ")}`);
    }

    values[role] = token.color ?? foreground;
  }

  const mode = theme.type;
  if (mode !== "light" && mode !== "dark") {
    throw new Error(`${id}: theme has no mode`);
  }
  return roleValuesFrom({ id, type: mode }, values, background, foreground);
};

const passesContrast = (sheet: Sheet): boolean =>
  [sheet.foreground, ...ROLES.map((role) => sheet.values[role])].every((value) => {
    const ratio = contrastRatio(value, sheet.background);
    return ratio !== null && ratio >= LIMIT;
  });

const derived = new Map<string, Sheet>();
const derivable = new Set<string>();

for (const info of bundledThemesInfo) {
  const sheet = await derive(info.id);
  derived.set(info.id, sheet);
  if (passesContrast(sheet)) derivable.add(info.id);
}

const sheetFiles = readdirSync(SHEET_DIR)
  .filter((file) => file.endsWith(".css"))
  .toSorted((a, b) => a.localeCompare(b));

describe("theme sheets", () => {
  it("derives every value from the source theme", () => {
    for (const file of sheetFiles) {
      const id = file.slice(0, -".css".length);
      const expected = derived.get(id);
      expect(expected, id).toBeDefined();
      if (expected === undefined) continue;

      const mismatches = declarationMismatches(
        sheetDeclarations(expected) as Record<string, string>,
        parseSheet(file),
      );
      expect(mismatches, `${id}: ${mismatches.join(", ")}`).toEqual([]);
    }
  });

  it("defines every role in every sheet, and nothing else", () => {
    const expected = [
      ...ROLES.map((role) => `${ROLE_VARIABLE_PREFIX}${role}`),
      BACKGROUND_VARIABLE,
      FOREGROUND_VARIABLE,
    ].toSorted((a, b) => a.localeCompare(b));

    for (const file of sheetFiles) {
      expect(
        Object.keys(parseSheet(file)).toSorted((a, b) => a.localeCompare(b)),
        file,
      ).toEqual(expected);
    }
  });

  it("passes 4.5:1 for every role against its own background", () => {
    for (const file of sheetFiles) {
      const declarations = parseSheet(file);
      const background = declarations[BACKGROUND_VARIABLE] ?? "";
      for (const [name, value] of Object.entries(declarations)) {
        if (name === BACKGROUND_VARIABLE) continue;
        const ratio = contrastRatio(value ?? "", background);
        expect(ratio, `${file} ${name}`).not.toBeNull();
        expect(ratio ?? 0, `${file} ${name}`).toBeGreaterThanOrEqual(LIMIT);
      }
    }
  });

  it("ships exactly the offerable set", () => {
    const shipped = new Set(sheetFiles.map((file) => file.slice(0, -".css".length)));

    expect([...shipped].toSorted((a, b) => a.localeCompare(b))).toEqual(
      [...derivable].toSorted((a, b) => a.localeCompare(b)),
    );
  });

  it("scopes every sheet to exactly one mode", () => {
    for (const file of sheetFiles) {
      const id = file.slice(0, -".css".length);
      const css = readFileSync(new URL(file, SHEET_DIR), "utf8");
      const selectors = [...css.matchAll(/\[data-theme="([a-z]+)"\]/gu)].map((match) => match[1]);

      expect(selectors, file).toEqual([derived.get(id)?.mode]);
      expect(css.slice(0, css.indexOf("{"))).toBe(`[data-theme="${selectors[0]}"] `);
      expect(css.slice(css.lastIndexOf("}") + 1).trim()).toBe("");
    }
  });

  it("closes the role set over the grammar corpus", async () => {
    const aliases: Record<string, string> = {
      ts: "typescript",
      tsx: "tsx",
      js: "javascript",
      jsx: "jsx",
      sh: "bash",
      yml: "yaml",
    };
    const known = new Set([
      "typescript",
      "tsx",
      "javascript",
      "jsx",
      "json",
      "bash",
      "markdown",
      "yaml",
      "html",
      "css",
      "python",
      "rust",
      "go",
      "sql",
      "diff",
      "dockerfile",
    ]);
    await highlighter.loadTheme(ROLE_THEME as never);
    const markup: string[] = [];
    for (const fixture of ["render-fidelity/grammar-corpus.md", "kitchen-sink.md"]) {
      const source = readFileSync(new URL(fixture, FIXTURES), "utf8");
      for (const match of source.matchAll(/```([a-z0-9-]*)\n([\s\S]*?)```/gu)) {
        const fence = match[1] ?? "";
        const code = match[2] ?? "";
        const lang = aliases[fence] ?? fence;
        if (!known.has(lang)) continue;
        const grammar = await import(`shiki/langs/${lang}.mjs`);
        await highlighter.loadLanguage(grammar.default);
        markup.push(highlighter.codeToHtml(code, { lang, theme: ROLE_THEME.name }));
      }
    }

    const used = new Set(
      markup.flatMap((html) =>
        [...html.matchAll(/var\(--mdv-token-([a-z]+)\)/gu)].map((match) => match[1]),
      ),
    );
    expect([...used].toSorted((a, b) => a.localeCompare(b))).toEqual(
      [...ROLES].toSorted((a, b) => a.localeCompare(b)),
    );

    const fallbacks = markup
      .flatMap((html) => [...html.matchAll(/var\(--mdv-foreground\)/gu)])
      .map(() => 1).length;
    expect(fallbacks).toBe(RECORDED_FOREGROUND_FALLBACKS);
  });

  it("fails when a committed value drifts", () => {
    const sheet = derived.get("github-light-high-contrast");
    expect(sheet).toBeDefined();
    if (sheet === undefined) return;

    const expected = sheetDeclarations(sheet) as Record<string, string>;
    const drifted = { ...parseSheet("github-light-high-contrast.css") };
    drifted["--mdv-token-keyword"] = "#000000";

    expect(declarationMismatches(expected, drifted)).toEqual(["--mdv-token-keyword"]);
  });
});
