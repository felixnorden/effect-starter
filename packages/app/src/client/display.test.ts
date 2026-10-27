import { describe, expect, it } from "vitest";

import {
  DARK_THEME_KEY,
  defaultDisplay,
  LIGHT_THEME_KEY,
  optionsForMode,
  readDisplay,
  sheetUrl,
  toggleLineNumbers,
  withTheme,
} from "./display.ts";
import { DEFAULT_DARK_THEME, DEFAULT_LIGHT_THEME } from "./theme-defaults.ts";

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

describe("readDisplay", () => {
  it("resolves the stored pair, else the defaults", () => {
    const stored = fakeStorage({
      [LIGHT_THEME_KEY]: "light-plus",
      [DARK_THEME_KEY]: "dark-plus",
    });
    expect(readDisplay(stored).light.id).toBe("light-plus");
    expect(readDisplay(stored).dark.id).toBe("dark-plus");

    const empty = fakeStorage();
    expect(readDisplay(empty).light.id).toBe(DEFAULT_LIGHT_THEME);
    expect(readDisplay(empty).dark.id).toBe(DEFAULT_DARK_THEME);
  });

  it("ignores a stored id that is not offered, or that belongs to the other mode", () => {
    const removed = fakeStorage({ [LIGHT_THEME_KEY]: "not-a-theme" });
    expect(readDisplay(removed).light.id).toBe(DEFAULT_LIGHT_THEME);

    const wrongMode = fakeStorage({
      [LIGHT_THEME_KEY]: DEFAULT_DARK_THEME,
      [DARK_THEME_KEY]: "dark-plus",
    });
    const display = readDisplay(wrongMode);
    expect(display.light.id).toBe(DEFAULT_LIGHT_THEME);
    expect(display.dark.id).toBe("dark-plus");
  });
});

describe("withTheme", () => {
  it("writes only the touched key", () => {
    const { storage, writes } = fakeStorage();

    const next = withTheme(defaultDisplay(), "light", "light-plus", { storage });

    expect(next.light.id).toBe("light-plus");
    expect(next.dark.id).toBe(DEFAULT_DARK_THEME);
    expect(writes).toEqual([[LIGHT_THEME_KEY, "light-plus"]]);
  });

  it("leaves the display alone for an id of the other mode", () => {
    const { storage, writes } = fakeStorage();
    const display = defaultDisplay();

    expect(withTheme(display, "light", DEFAULT_DARK_THEME, { storage })).toBe(display);
    expect(writes).toEqual([]);
  });
});

describe("line numbers", () => {
  it("defaults to off and reads the stored choice", () => {
    expect(readDisplay(fakeStorage()).lineNumbers).toBe(false);
    expect(readDisplay(fakeStorage({ "preview-line-numbers": "on" })).lineNumbers).toBe(true);
  });

  it("treats an unknown stored value as off", () => {
    expect(readDisplay(fakeStorage({ "preview-line-numbers": "yes" })).lineNumbers).toBe(false);
  });

  it("toggles and persists as a new object", () => {
    const { storage, writes } = fakeStorage();
    const display = defaultDisplay();

    const next = toggleLineNumbers(display, { storage });

    expect(next).not.toBe(display);
    expect(next.lineNumbers).toBe(true);
    expect(writes).toEqual([["preview-line-numbers", "on"]]);
  });
});

describe("optionsForMode", () => {
  it("offers each slot only its own mode", () => {
    for (const mode of ["light", "dark"] as const) {
      const options = optionsForMode(mode);
      expect(options.length).toBeGreaterThan(0);
      for (const option of options) expect(option.type).toBe(mode);
      expect(
        options.some(
          (option) => option.id === (mode === "light" ? DEFAULT_LIGHT_THEME : DEFAULT_DARK_THEME),
        ),
      ).toBe(true);
    }
  });
});

describe("sheetUrl", () => {
  it("maps a theme id to one sheet URL spelling", () => {
    expect(sheetUrl("some-theme")).toBe("/theme-sheets/some-theme.css");
  });
});
