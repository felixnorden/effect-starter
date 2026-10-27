#!/usr/bin/env bun
/**
 * Derive one mode-scoped theme sheet per offerable bundled Shiki theme.
 *
 * A theme is offerable when its foreground and every role value reach 4.5:1
 * against its own background. The committed sheets and the typed list are the
 * input to `bun run check`; the drift check recomputes this derivation.
 */
import {
  DEFAULT_DARK_THEME,
  DEFAULT_LIGHT_THEME,
} from "../packages/app/src/client/theme-defaults.ts";
import { contrastRatio } from "../packages/app/src/contrast.ts";
import {
  ROLE_EXEMPLARS,
  ROLES,
  ROLE_SCOPES,
  type Role,
} from "../packages/core/src/render/highlight.ts";
import { roleValuesFrom, sheetCss } from "../packages/core/src/render/theme-sheets.ts";
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHighlighterCore } from "shiki/core";
import { createOnigurumaEngine } from "shiki/engine/oniguruma";
import { bundledThemes, bundledThemesInfo } from "shiki/themes";

const LIMIT = 4.5;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDir = path.join(root, "packages/app/src/client/public/theme-sheets");
const listPath = path.join(root, "packages/app/src/client/theme-options.ts");

const matchesScope = (scope: string, target: string): boolean =>
  scope === target || scope.startsWith(`${target}.`);

const highlighter = await createHighlighterCore({
  themes: [],
  langs: [],
  engine: await createOnigurumaEngine(import("shiki/wasm")),
});

for (const lang of new Set(Object.values(ROLE_EXEMPLARS).map((exemplar) => exemplar.lang))) {
  const grammar = await import(`shiki/langs/${lang}.mjs`);
  await highlighter.loadLanguage(grammar.default);
}

type Token = {
  readonly content: string;
  readonly offset: number;
  readonly color?: string;
  readonly explanation?: readonly {
    readonly scopes: readonly { readonly scopeName: string }[];
  }[];
};

const roleValues = (themeId: string, foreground: string): Record<Role, string> => {
  const values = {} as Record<Role, string>;

  for (const role of ROLES) {
    const exemplar = ROLE_EXEMPLARS[role];
    const result = highlighter.codeToTokens(exemplar.code, {
      lang: exemplar.lang,
      theme: themeId,
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
      throw new Error(`${themeId} ${role}: no token at ${exemplar.token}`);
    }

    const scopes = (token.explanation ?? []).flatMap((entry) =>
      entry.scopes.map((scope) => scope.scopeName),
    );
    const paintsRole = ROLE_SCOPES[role].some((target) =>
      scopes.some((scope) => matchesScope(scope, target)),
    );
    if (!paintsRole) {
      throw new Error(
        `${themeId} ${role}: exemplar ${exemplar.token} is not painted by ${ROLE_SCOPES[role].join(", ")}`,
      );
    }

    values[role] = token.color ?? foreground;
  }

  return values;
};

type Offered = {
  readonly id: string;
  readonly label: string;
  readonly type: "light" | "dark";
  readonly sheet: ReturnType<typeof roleValuesFrom>;
};

const offered: Offered[] = [];

for (const info of bundledThemesInfo) {
  const loaded = (await bundledThemes[info.id]()).default;
  await highlighter.loadTheme(loaded);

  const background = loaded.colors?.["editor.background"] ?? "#ffffff";
  const foreground = loaded.colors?.["editor.foreground"] ?? "#000000";
  const values = roleValues(info.id, foreground);
  const passes = [foreground, ...Object.values(values)].every((value) => {
    const ratio = contrastRatio(value, background);
    return ratio !== null && ratio >= LIMIT;
  });
  if (!passes) continue;

  const mode = loaded.type;
  if (mode !== "light" && mode !== "dark") {
    throw new Error(`${info.id}: theme has no mode`);
  }
  offered.push({
    id: info.id,
    label: info.displayName,
    type: mode,
    sheet: roleValuesFrom({ id: info.id, type: mode }, values, background, foreground),
  });
}

for (const required of [DEFAULT_LIGHT_THEME, DEFAULT_DARK_THEME]) {
  if (!offered.some((entry) => entry.id === required)) {
    throw new Error(`default theme ${required} is not offerable`);
  }
}

mkdirSync(outputDir, { recursive: true });
const wanted = new Set(offered.map((entry) => `${entry.id}.css`));
for (const file of readdirSync(outputDir)) {
  if (file.endsWith(".css") && !wanted.has(file)) rmSync(path.join(outputDir, file));
}
for (const entry of offered) {
  writeFileSync(path.join(outputDir, `${entry.id}.css`), sheetCss(entry.sheet));
}

const list = offered
  .toSorted((a, b) => a.id.localeCompare(b.id))
  .map(
    (entry) =>
      `  {\n    id: ${JSON.stringify(entry.id)},\n    label: ${JSON.stringify(entry.label)},\n    type: ${JSON.stringify(entry.type)},\n  },`,
  )
  .join("\n");

writeFileSync(
  listPath,
  `// Generated by scripts/generate-theme-sheets.ts. Do not edit.\n\nexport type ThemeMode = "light" | "dark";\n\nexport type ThemeOption = {\n  readonly id: string;\n  readonly label: string;\n  readonly type: ThemeMode;\n};\n\nexport const THEME_OPTIONS: readonly ThemeOption[] = [\n${list}\n];\n`,
);

console.log(`wrote ${offered.length} theme sheets`);
