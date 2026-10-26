import { describe, expect, it } from "vitest";

import { applyTheme, resolveTheme, setTheme, THEME_KEY, toggleTheme } from "./theme.ts";

const darkSystem = (query: string) => ({ matches: query.includes("dark") });

const fakeStorage = () => {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
};

describe("resolveTheme", () => {
  it("follows the system preference when nothing is stored", () => {
    const storage = fakeStorage();

    expect(resolveTheme({ matchMedia: darkSystem, storage })).toBe("dark");
  });

  it("persists a manual toggle for the page session", () => {
    const storage = fakeStorage();

    setTheme("light", { storage });

    expect(storage.getItem(THEME_KEY)).toBe("light");
    expect(resolveTheme({ matchMedia: darkSystem, storage })).toBe("light");
  });

  it("toggles back with the same key", () => {
    const storage = fakeStorage();
    const first = toggleTheme("dark", { storage });
    const second = toggleTheme(first, { storage });

    expect([first, second]).toEqual(["light", "dark"]);
    expect(storage.getItem(THEME_KEY)).toBe("dark");
  });

  it("sets the data-theme attribute on the root element", () => {
    const attributes = new Map<string, string>();

    applyTheme("dark", {
      setAttribute: (name, value) => {
        attributes.set(name, value);
      },
    });

    expect(attributes.get("data-theme")).toBe("dark");
  });
});
