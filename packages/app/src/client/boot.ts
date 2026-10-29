import { applyView, type View } from "./axes.ts";
import type { Display } from "./display.ts";
import {
  pageThemeOf,
  readColorMode,
  readPageTheme,
  type PageThemeScheme,
  type PageThemeSlots,
} from "./page-theme.ts";
import { readPresets, type Presets } from "./view-presets.ts";

export type BootDeps = {
  readonly storage: Storage;
  readonly matchMedia: (query: string) => { readonly matches: boolean };
  readonly display: Display;
  readonly root: { setAttribute(name: string, value: string): void };
};

export type ResolvedView = {
  readonly slots: PageThemeSlots;
  readonly mode: PageThemeScheme;
  readonly presets: Presets;
  readonly view: View;
  readonly display: Display;
};

/**
 * Resolve, validate, apply. Runs once per load, before the client root exists
 * and after the generated head snippet has painted the same four attributes.
 */
export const bootView = (deps: BootDeps): ResolvedView => {
  const slots = readPageTheme({ storage: deps.storage });
  const mode = readColorMode({ storage: deps.storage, matchMedia: deps.matchMedia });
  const presets = readPresets({ storage: deps.storage });
  const view: View = {
    pageTheme: pageThemeOf(slots, mode),
    colorMode: mode,
    width: presets.width,
    scale: presets.scale,
  };

  applyView(view, deps.root);

  return { slots, mode, presets, view, display: deps.display };
};
