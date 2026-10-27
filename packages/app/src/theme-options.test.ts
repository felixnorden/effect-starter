import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { DEFAULT_DARK_THEME, DEFAULT_LIGHT_THEME } from "./client/theme-defaults.ts";
import { THEME_OPTIONS } from "./client/theme-options.ts";

const SHEET_DIR = new URL("./client/public/theme-sheets/", import.meta.url);

const shipped = readdirSync(SHEET_DIR)
  .filter((file) => file.endsWith(".css"))
  .map((file) => file.slice(0, -".css".length))
  .toSorted((a, b) => a.localeCompare(b));

describe("THEME_OPTIONS", () => {
  it("ships one option per committed sheet, in both directions", () => {
    const ids = THEME_OPTIONS.map((option) => option.id).toSorted((a, b) => a.localeCompare(b));

    expect(ids).toEqual(shipped);
  });

  it("carries a label and a mode for every option", () => {
    for (const option of THEME_OPTIONS) {
      expect(option.label.trim().length).toBeGreaterThan(0);
      expect(["light", "dark"]).toContain(option.type);
    }
  });

  it("names the shipped default pair and offers each id for its own mode", () => {
    for (const [id, type] of [
      [DEFAULT_LIGHT_THEME, "light"],
      [DEFAULT_DARK_THEME, "dark"],
    ] as const) {
      const option = THEME_OPTIONS.find((entry) => entry.id === id);
      expect(option).toBeDefined();
      expect(option?.type).toBe(type);
    }
  });
});
