import { COLOR_MODE_ATTRIBUTE } from "./axes.ts";
import {
  COLOR_MODE_KEY,
  defaultPageTheme,
  PAGE_THEME_DARK_KEY,
  PAGE_THEME_LIGHT_KEY,
  PAGE_THEMES,
  type PageThemeScheme,
} from "./page-theme.ts";
import { SCALE_KEY, SCALE_PRESETS, WIDTH_KEY, WIDTH_PRESETS } from "./view-presets.ts";

const json = (value: unknown): string => JSON.stringify(value);

const namesFor = (scheme: PageThemeScheme): readonly string[] =>
  PAGE_THEMES.filter((theme) => theme.scheme === scheme).map((theme) => theme.name);

/**
 * The <head> script: no imports, no framework, must run before first paint.
 * Generated from the same constants the readers use, so the names, keys, and
 * presets cannot drift. A broken read falls back per axis.
 */
export const prePaintScript = `(function () {
  var read = function (key) {
    try {
      return window.sessionStorage.getItem(key);
    } catch (error) {
      return null;
    }
  };
  var pick = function (stored, allowed, fallback) {
    return allowed.indexOf(stored) === -1 ? fallback : stored;
  };
  var themes = ${json({ light: namesFor("light"), dark: namesFor("dark") })};
  var defaults = ${json({ light: defaultPageTheme("light"), dark: defaultPageTheme("dark") })};
  var slots = {
    light: pick(read(${json(PAGE_THEME_LIGHT_KEY)}), themes.light, defaults.light),
    dark: pick(read(${json(PAGE_THEME_DARK_KEY)}), themes.dark, defaults.dark)
  };
  var stored = pick(read(${json(COLOR_MODE_KEY)}), ["light", "dark"], null);
  var mode =
    stored === null
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
      : stored;
  var root = document.documentElement;
  root.setAttribute("data-theme", slots[mode]);
  root.setAttribute(${json(COLOR_MODE_ATTRIBUTE)}, mode);
  root.setAttribute("data-width", pick(read(${json(WIDTH_KEY)}), ${json(WIDTH_PRESETS)}, "normal"));
  root.setAttribute("data-scale", pick(read(${json(SCALE_KEY)}), ${json(SCALE_PRESETS)}, "normal"));
})();`;
