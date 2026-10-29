import { describe, expect, it } from "vitest";

import {
  defaultPageTheme,
  isPageTheme,
  PAGE_THEMES,
  pageThemesFor,
  type PageThemeScheme,
} from "./page-theme.ts";

const SCHEMES: readonly PageThemeScheme[] = ["light", "dark"];

describe("PAGE_THEMES", () => {
  it("offers three page themes per colour scheme", () => {
    for (const scheme of SCHEMES) {
      const themes = pageThemesFor(scheme);

      expect(themes).toHaveLength(3);
      expect(themes.every((theme) => theme.scheme === scheme)).toBe(true);
      expect(themes.every((theme) => theme.name.length > 0)).toBe(true);
      expect(themes.every((theme) => theme.label.length > 0)).toBe(true);
    }
  });

  it("names only daisyUI built-in themes", () => {
    const builtIn = [
      "light",
      "dark",
      "corporate",
      "garden",
      "dim",
      "dracula",
      "nord",
      "lofi",
      "night",
    ];

    expect(PAGE_THEMES.every((theme) => builtIn.includes(theme.name))).toBe(true);
    expect(new Set(PAGE_THEMES.map((theme) => theme.name)).size).toBe(PAGE_THEMES.length);
  });
});

describe("defaultPageTheme", () => {
  it("returns daisyUI's own default pair", () => {
    expect(defaultPageTheme("light")).toBe("light");
    expect(defaultPageTheme("dark")).toBe("dark");
  });
});

describe("isPageTheme", () => {
  it("rejects a name that declares the other scheme", () => {
    expect(isPageTheme("garden", "dark")).toBe(false);
    expect(isPageTheme("garden", "light")).toBe(true);
    expect(isPageTheme("solarized", "light")).toBe(false);
  });
});
