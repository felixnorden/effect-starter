import { ROLES, type Role } from "./highlight.ts";

export const ROLE_VARIABLE_PREFIX = "--mdv-token-";
export const BACKGROUND_VARIABLE = "--mdv-background";
export const FOREGROUND_VARIABLE = "--mdv-foreground";

export type ThemeMode = "light" | "dark";

/** The root attribute the page writes and the generated sheets are keyed on. */
export const COLOR_MODE_ATTRIBUTE = "data-color-mode";

export type SheetTheme = {
  readonly id: string;
  readonly type: ThemeMode;
};

export type Sheet = {
  readonly id: string;
  readonly mode: ThemeMode;
  readonly values: Readonly<Record<Role, string>>;
  readonly background: string;
  readonly foreground: string;
};

/** One derivation rule for the generator and the drift check. */
export const roleValuesFrom = (
  theme: SheetTheme,
  values: Readonly<Record<Role, string>>,
  background: string,
  foreground: string,
): Sheet => ({
  id: theme.id,
  mode: theme.type,
  values,
  background,
  foreground,
});

export type SheetDeclarations = Readonly<Record<string, string>>;

/** The sheet as declarations, keyed by variable name; one map for both sides. */
export const sheetDeclarations = (sheet: Sheet): SheetDeclarations =>
  Object.fromEntries([
    ...ROLES.map((role) => [`${ROLE_VARIABLE_PREFIX}${role}`, sheet.values[role]]),
    [BACKGROUND_VARIABLE, sheet.background],
    [FOREGROUND_VARIABLE, sheet.foreground],
  ]);

/** The variable names whose expected and committed values differ. */
export const declarationMismatches = (
  expected: SheetDeclarations,
  actual: SheetDeclarations,
): readonly string[] =>
  [...new Set([...Object.keys(expected), ...Object.keys(actual)])]
    .filter((name) => expected[name] !== actual[name])
    .toSorted((a, b) => a.localeCompare(b));

/** The sheet's one mode-scoped block; the role order is fixed by `ROLES`. */
export const sheetCss = (sheet: Sheet): string =>
  `[${COLOR_MODE_ATTRIBUTE}="${sheet.mode}"] {\n${[
    ...ROLES.map((role) => `${ROLE_VARIABLE_PREFIX}${role}: ${sheet.values[role]};`),
    `${BACKGROUND_VARIABLE}: ${sheet.background};`,
    `${FOREGROUND_VARIABLE}: ${sheet.foreground};`,
  ]
    .map((declaration) => `  ${declaration}`)
    .join("\n")}\n}\n`;
