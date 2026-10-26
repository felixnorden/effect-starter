export type Theme = "light" | "dark";

export const THEME_KEY = "preview-theme";

type MatchMedia = (query: string) => { readonly matches: boolean };

type Storage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

export type ThemeDeps = {
  readonly matchMedia: MatchMedia;
  readonly storage: Storage;
};

const isTheme = (value: string | null): value is Theme => value === "light" || value === "dark";

/** A stored manual choice wins; otherwise the system preference decides. */
export const resolveTheme = (deps: ThemeDeps): Theme => {
  const stored = deps.storage.getItem(THEME_KEY);
  if (isTheme(stored)) return stored;
  return deps.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
};

/** Persist a manual choice for the page session. */
export const setTheme = (theme: Theme, deps: Pick<ThemeDeps, "storage">): Theme => {
  deps.storage.setItem(THEME_KEY, theme);
  return theme;
};

export const toggleTheme = (theme: Theme, deps: Pick<ThemeDeps, "storage">): Theme =>
  setTheme(theme === "dark" ? "light" : "dark", deps);

export const applyTheme = (
  theme: Theme,
  root: { setAttribute(name: string, value: string): void },
): void => {
  root.setAttribute("data-theme", theme);
};
