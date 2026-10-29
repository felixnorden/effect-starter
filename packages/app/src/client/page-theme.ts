export type PageThemeScheme = "light" | "dark";

export type PageTheme = {
  /** A daisyUI built-in theme name. */
  readonly name: string;
  /** What the picker shows. */
  readonly label: string;
  readonly scheme: PageThemeScheme;
};

/**
 * The one enumeration the pickers, boot, the pre-paint snippet, the plugin
 * configuration test, and the contrast matrix read. Six names: three per scheme.
 */
export const PAGE_THEMES: readonly PageTheme[] = [
  { name: "light", label: "Light", scheme: "light" },
  { name: "corporate", label: "Corporate", scheme: "light" },
  { name: "garden", label: "Garden", scheme: "light" },
  { name: "dark", label: "Dark", scheme: "dark" },
  { name: "dim", label: "Dim", scheme: "dark" },
  { name: "dracula", label: "Dracula", scheme: "dark" },
];

export const pageThemesFor = (scheme: PageThemeScheme): readonly PageTheme[] =>
  PAGE_THEMES.filter((theme) => theme.scheme === scheme);

/** daisyUI's own default pair, declared with the shipped markers in the entry. */
export const defaultPageTheme = (scheme: PageThemeScheme): string =>
  scheme === "light" ? "light" : "dark";

export const isPageTheme = (name: string, scheme: PageThemeScheme): boolean =>
  pageThemesFor(scheme).some((theme) => theme.name === name);

export const PAGE_THEME_LIGHT_KEY = "preview-page-theme-light";
export const PAGE_THEME_DARK_KEY = "preview-page-theme-dark";
export const COLOR_MODE_KEY = "preview-color-mode";

export type PageThemeSlots = { readonly light: string; readonly dark: string };

type MatchMedia = (query: string) => { readonly matches: boolean };

const KEY_OF: Record<PageThemeScheme, string> = {
  light: PAGE_THEME_LIGHT_KEY,
  dark: PAGE_THEME_DARK_KEY,
};

const isColorMode = (value: string | null): value is PageThemeScheme =>
  value === "light" || value === "dark";

const readSlot = (scheme: PageThemeScheme, storage: Storage): string => {
  const stored = storage.getItem(KEY_OF[scheme]);
  return stored !== null && isPageTheme(stored, scheme) ? stored : defaultPageTheme(scheme);
};

/** One validated name per slot; the stored value never decides the mode. */
export const readPageTheme = (deps: { readonly storage: Storage }): PageThemeSlots => ({
  light: readSlot("light", deps.storage),
  dark: readSlot("dark", deps.storage),
});

/** A stored manual choice wins; otherwise the system preference decides. */
export const readColorMode = (deps: {
  readonly storage: Storage;
  readonly matchMedia: MatchMedia;
}): PageThemeScheme => {
  const stored = deps.storage.getItem(COLOR_MODE_KEY);
  if (isColorMode(stored)) return stored;
  return deps.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
};

/** Persist one slot, and only when the name belongs to that scheme. */
export const setPageTheme = (
  slots: PageThemeSlots,
  scheme: PageThemeScheme,
  name: string,
  deps: { readonly storage: Storage },
): PageThemeSlots => {
  if (!isPageTheme(name, scheme)) return slots;
  deps.storage.setItem(KEY_OF[scheme], name);
  return { ...slots, [scheme]: name };
};

/** Flip the mode; the slot names stay exactly as they are. */
export const toggleColorMode = (
  mode: PageThemeScheme,
  deps: { readonly storage: Storage },
): PageThemeScheme => {
  const next: PageThemeScheme = mode === "dark" ? "light" : "dark";
  deps.storage.setItem(COLOR_MODE_KEY, next);
  return next;
};

export const pageThemeOf = (slots: PageThemeSlots, mode: PageThemeScheme): string => slots[mode];
