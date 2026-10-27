import { DEFAULT_DARK_THEME, DEFAULT_LIGHT_THEME } from "./theme-defaults.ts";
import { THEME_OPTIONS, type ThemeOption } from "./theme-options.ts";

export const LIGHT_THEME_KEY = "preview-code-theme-light";
export const DARK_THEME_KEY = "preview-code-theme-dark";
export const LINE_NUMBERS_KEY = "preview-line-numbers";

export type ThemeSlot = "light" | "dark";

export type Display = {
  readonly light: ThemeOption;
  readonly dark: ThemeOption;
  readonly lineNumbers: boolean;
};

const KEY_OF: Record<ThemeSlot, string> = {
  light: LIGHT_THEME_KEY,
  dark: DARK_THEME_KEY,
};

/** Every offered theme of one mode: the one filter a selector and a read share. */
export const optionsForMode = (mode: ThemeSlot): readonly ThemeOption[] =>
  THEME_OPTIONS.filter((option) => option.type === mode);

const defaultFor = (mode: ThemeSlot): ThemeOption => {
  const id = mode === "light" ? DEFAULT_LIGHT_THEME : DEFAULT_DARK_THEME;
  const option = THEME_OPTIONS.find((entry) => entry.id === id);
  if (option === undefined) throw new Error(`default ${mode} theme is not offered: ${id}`);
  return option;
};

export const defaultDisplay = (): Display => ({
  light: defaultFor("light"),
  dark: defaultFor("dark"),
  lineNumbers: false,
});

/** A stored id when it is offered for that slot, else that slot's default. */
export const readDisplay = (deps: { readonly storage: Storage }): Display => {
  const read = (slot: ThemeSlot): ThemeOption => {
    const stored = deps.storage.getItem(KEY_OF[slot]);
    return optionsForMode(slot).find((option) => option.id === stored) ?? defaultFor(slot);
  };

  return {
    light: read("light"),
    dark: read("dark"),
    lineNumbers: deps.storage.getItem(LINE_NUMBERS_KEY) === "on",
  };
};

/** Flip the third display choice and persist exactly that key. */
export const toggleLineNumbers = (
  display: Display,
  deps: { readonly storage: Storage },
): Display => {
  const lineNumbers = !display.lineNumbers;
  deps.storage.setItem(LINE_NUMBERS_KEY, lineNumbers ? "on" : "off");
  return { ...display, lineNumbers };
};

/** The one URL spelling, shared by the links and the tests. */
export const sheetUrl = (id: string): string => `/theme-sheets/${id}.css`;

/** Flip one slot, persist exactly that key, leave the other slot alone. */
export const withTheme = (
  display: Display,
  slot: ThemeSlot,
  id: string,
  deps: { readonly storage: Storage },
): Display => {
  const option = optionsForMode(slot).find((entry) => entry.id === id);
  if (option === undefined) return display;

  deps.storage.setItem(KEY_OF[slot], option.id);
  return { ...display, [slot]: option };
};
