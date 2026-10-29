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
