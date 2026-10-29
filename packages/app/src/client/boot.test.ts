import { describe, expect, it } from "vitest";

import { bootView } from "./boot.ts";
import { readDisplay } from "./display.ts";
import { DEFAULT_DARK_THEME, DEFAULT_LIGHT_THEME } from "./theme-defaults.ts";

import { COLOR_MODE_KEY, PAGE_THEME_DARK_KEY, PAGE_THEME_LIGHT_KEY } from "./page-theme.ts";

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

const recordingRoot = () => {
  const calls: Array<readonly [string, string]> = [];
  return {
    calls,
    root: {
      setAttribute: (name: string, value: string) => {
        calls.push([name, value]);
      },
    },
  };
};

const darkSystem = (query: string) => ({ matches: query.includes("dark") });

describe("bootView", () => {
  it("resolves and applies the validated view before the root renders", () => {
    const { storage } = fakeStorage({
      [PAGE_THEME_LIGHT_KEY]: "dracula",
      [PAGE_THEME_DARK_KEY]: "solarized",
      "preview-code-theme-light": "no-such-theme",
      "preview-width": "wide",
    });
    const { calls, root } = recordingRoot();

    const booted = bootView({
      storage,
      matchMedia: darkSystem,
      display: readDisplay({ storage }),
      root,
    });

    expect(booted.slots).toEqual({ light: "light", dark: "dark" });
    expect(booted.mode).toBe("dark");
    expect(booted.presets).toEqual({ width: "wide", scale: "normal" });
    expect(calls).toEqual([
      ["data-theme", "dark"],
      ["data-color-mode", "dark"],
      ["data-width", "wide"],
      ["data-scale", "normal"],
    ]);
    expect(booted.display.light.id).toBe(DEFAULT_LIGHT_THEME);
    expect(booted.display.dark.id).toBe(DEFAULT_DARK_THEME);
  });

  it("uses the stored slot for the active mode", () => {
    const { storage } = fakeStorage({
      [PAGE_THEME_LIGHT_KEY]: "garden",
      [COLOR_MODE_KEY]: "light",
    });
    const { calls, root } = recordingRoot();

    const booted = bootView({
      storage,
      matchMedia: darkSystem,
      display: readDisplay({ storage }),
      root,
    });

    expect(booted.view).toEqual({
      pageTheme: "garden",
      colorMode: "light",
      width: "normal",
      scale: "normal",
    });
    expect(calls[0]).toEqual(["data-theme", "garden"]);
  });
});
