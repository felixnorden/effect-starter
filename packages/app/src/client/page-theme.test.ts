import { describe, expect, it } from "vitest";

import {
  COLOR_MODE_KEY,
  defaultPageTheme,
  isPageTheme,
  PAGE_THEME_DARK_KEY,
  PAGE_THEME_LIGHT_KEY,
  PAGE_THEMES,
  pageThemeOf,
  pageThemesFor,
  readColorMode,
  readPageTheme,
  setPageTheme,
  toggleColorMode,
  type PageThemeScheme,
} from "./page-theme.ts";

const SCHEMES: readonly PageThemeScheme[] = ["light", "dark"];

const fakeStorage = (values: Record<string, string> = {}) => {
  const data = new Map(Object.entries(values));
  const writes: Array<readonly [string, string]> = [];

  const storage = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
      writes.push([key, value]);
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
    clear: () => data.clear(),
    key: (index: number) => [...data.keys()][index] ?? null,
    get length() {
      return data.size;
    },
  } as Storage;

  return { storage, writes };
};

const darkSystem = (query: string) => ({ matches: query.includes("dark") });
const lightSystem = (query: string) => ({ matches: !query.includes("dark") });

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

describe("readPageTheme", () => {
  it("reads the stored slots, else each slot's default", () => {
    const { storage } = fakeStorage({ [PAGE_THEME_LIGHT_KEY]: "corporate" });

    expect(readPageTheme({ storage })).toEqual({
      light: "corporate",
      dark: defaultPageTheme("dark"),
    });
  });

  it("rejects a stored name that declares the other scheme or is no longer shipped", () => {
    const { storage } = fakeStorage({
      [PAGE_THEME_LIGHT_KEY]: "dracula",
      [PAGE_THEME_DARK_KEY]: "solarized",
    });

    expect(readPageTheme({ storage })).toEqual({ light: "light", dark: "dark" });
  });
});

describe("readColorMode", () => {
  it("follows the system preference when no choice is stored", () => {
    const { storage } = fakeStorage();

    expect(readColorMode({ storage, matchMedia: darkSystem })).toBe("dark");
    expect(readColorMode({ storage, matchMedia: lightSystem })).toBe("light");
  });

  it("prefers the stored choice over the system preference", () => {
    const { storage } = fakeStorage({ [COLOR_MODE_KEY]: "light" });

    expect(readColorMode({ storage, matchMedia: darkSystem })).toBe("light");
  });
});

describe("setPageTheme", () => {
  it("revises exactly one slot key", () => {
    const { storage, writes } = fakeStorage();

    const next = setPageTheme({ light: "light", dark: "dark" }, "dark", "dracula", { storage });

    expect(next).toEqual({ light: "light", dark: "dracula" });
    expect(writes).toEqual([[PAGE_THEME_DARK_KEY, "dracula"]]);
  });

  it("ignores a name that declares the other scheme", () => {
    const { storage, writes } = fakeStorage();
    const slots = { light: "light", dark: "dark" };

    expect(setPageTheme(slots, "dark", "garden", { storage })).toBe(slots);
    expect(writes).toEqual([]);
  });
});

describe("toggleColorMode", () => {
  it("moves to the other slot and rewrites neither name", () => {
    const { storage, writes } = fakeStorage({
      [PAGE_THEME_LIGHT_KEY]: "corporate",
      [PAGE_THEME_DARK_KEY]: "dim",
    });

    const first = toggleColorMode("light", { storage });
    const second = toggleColorMode(first, { storage });

    expect([first, second]).toEqual(["dark", "light"]);
    expect(writes).toEqual([
      [COLOR_MODE_KEY, "dark"],
      [COLOR_MODE_KEY, "light"],
    ]);
    expect(readPageTheme({ storage })).toEqual({ light: "corporate", dark: "dim" });
  });
});

describe("pageThemeOf", () => {
  it("selects the name of the active slot", () => {
    expect(pageThemeOf({ light: "garden", dark: "dim" }, "dark")).toBe("dim");
  });
});
