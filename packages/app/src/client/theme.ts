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

export const readStoredTheme = (storage: Storage): Theme | null => {
  const stored = storage.getItem(THEME_KEY);
  return isTheme(stored) ? stored : null;
};

export const systemTheme = (deps: Pick<ThemeDeps, "matchMedia">): Theme =>
  deps.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";

/** A stored manual choice wins; otherwise the system preference decides. */
export const resolveTheme = (deps: ThemeDeps): Theme =>
  readStoredTheme(deps.storage) ?? systemTheme(deps);

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
