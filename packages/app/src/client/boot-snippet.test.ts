import { runInNewContext } from "node:vm";

import { describe, expect, it } from "vitest";

import { prePaintScript } from "./boot-snippet.ts";
import { PAGE_THEMES } from "./page-theme.ts";

type SnippetOptions = {
  readonly values?: Record<string, string>;
  readonly throws?: boolean;
  readonly prefersDark?: boolean;
};

/** Execute the snippet in a bare context: no runner globals, only the browser's. */
const runSnippet = (options: SnippetOptions = {}): Map<string, string> => {
  const data = new Map(Object.entries(options.values ?? {}));
  const attributes = new Map<string, string>();

  runInNewContext(prePaintScript, {
    window: {
      sessionStorage: {
        getItem: (key: string) => {
          if (options.throws === true) throw new Error("storage denied");
          return data.get(key) ?? null;
        },
      },
      matchMedia: (query: string) => ({
        matches: options.prefersDark === true && query.includes("dark"),
      }),
    },
    document: {
      documentElement: {
        setAttribute: (name: string, value: string) => {
          attributes.set(name, value);
        },
      },
    },
  });

  return attributes;
};

describe("prePaintScript", () => {
  it("validates and applies all four axes", () => {
    const attributes = runSnippet({
      values: {
        "preview-page-theme-light": "corporate",
        "preview-page-theme-dark": "dracula",
        "preview-color-mode": "dark",
        "preview-width": "wide",
        "preview-scale": "large",
      },
    });

    expect(Object.fromEntries(attributes)).toEqual({
      "data-theme": "dracula",
      "data-color-mode": "dark",
      "data-width": "wide",
      "data-scale": "large",
    });
  });

  it("falls back per axis for corrupt values", () => {
    const attributes = runSnippet({
      values: {
        "preview-page-theme-light": "dracula",
        "preview-page-theme-dark": "solarized",
        "preview-color-mode": "purple",
        "preview-width": "huge",
        "preview-scale": "small",
      },
    });

    expect(Object.fromEntries(attributes)).toEqual({
      "data-theme": "light",
      "data-color-mode": "light",
      "data-width": "normal",
      "data-scale": "small",
    });
  });

  it("follows the system preference when no mode is stored", () => {
    expect(runSnippet({ prefersDark: true }).get("data-color-mode")).toBe("dark");
    expect(runSnippet().get("data-color-mode")).toBe("light");
  });

  it("leaves the page on the defaults when storage throws", () => {
    const attributes = runSnippet({ throws: true });

    expect(Object.fromEntries(attributes)).toEqual({
      "data-theme": "light",
      "data-color-mode": "light",
      "data-width": "normal",
      "data-scale": "normal",
    });
  });

  it("carries every shipped page theme name", () => {
    for (const theme of PAGE_THEMES) expect(prePaintScript).toContain(`"${theme.name}"`);
  });
});
