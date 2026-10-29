import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { PAGE_THEMES } from "./page-theme.ts";

const clientDir = fileURLToPath(new URL(".", import.meta.url));
const entryCss = readFileSync(path.join(clientDir, "daisyui.css"), "utf8");
const entrySource = readFileSync(path.join(clientDir, "main.tsx"), "utf8");

const PLUGIN_BLOCK = /@plugin\s+"daisyui"\s*\{([\s\S]*?)\}/u;
const OPTION_STATEMENT = /([a-z]+)\s*:\s*([\s\S]*?);/gu;

/** The plugin block's options, keyed by name; values are whitespace-collapsed. */
const options = (): Record<string, string> => {
  const block = PLUGIN_BLOCK.exec(entryCss)?.[1] ?? "";
  return Object.fromEntries(
    [...block.matchAll(OPTION_STATEMENT)].map((match) => [
      match[1] ?? "",
      (match[2] ?? "").replace(/\s+/gu, " ").trim(),
    ]),
  );
};

type ThemeEntry = { readonly name: string; readonly markers: readonly string[] };

const themeEntries = (value: string | undefined): readonly ThemeEntry[] =>
  (value ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((part) => {
      const [name = "", ...markers] = part.split(/\s+/u);
      return { name, markers };
    });

const list = (value: string | undefined): readonly string[] =>
  (value ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

describe("daisyui.css", () => {
  it("declares exactly the catalogue's names, with the shipped markers", () => {
    const entries = themeEntries(options()["themes"]);
    const shipped = new Map(entries.map((entry) => [entry.name, entry.markers]));

    expect([...shipped.keys()].toSorted()).toEqual(
      PAGE_THEMES.map((theme) => theme.name).toSorted(),
    );
    expect(shipped.get("light")).toContain("--default");
    expect(shipped.get("dark")).toContain("--prefersdark");
    for (const theme of PAGE_THEMES) {
      if (theme.name === "light" || theme.name === "dark") continue;
      expect(shipped.get(theme.name)).toEqual([]);
    }
  });

  it("loads the framework before configuring the plugin", () => {
    const framework = entryCss.indexOf('@import "tailwindcss"');
    const plugin = entryCss.indexOf('@plugin "daisyui"');
    const local = entryCss.indexOf("@import", framework + 1);

    expect(framework).toBeGreaterThanOrEqual(0);
    expect(plugin).toBeGreaterThan(framework);
    expect(local).toBe(-1);
  });

  it("carries configuration and no palette value", () => {
    expect(entryCss).not.toMatch(/#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(|\boklch?\(/iu);
    expect(entryCss).not.toContain('@plugin "daisyui/theme"');

    const allowed = new Set(["themes", "root", "include", "exclude", "prefix", "logs"]);
    expect(Object.keys(options()).every((key) => allowed.has(key))).toBe(true);

    const outside = entryCss.replace(PLUGIN_BLOCK, "");
    const declarations = outside
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("/*") && !line.startsWith("*"));

    expect(declarations).toEqual(['@import "tailwindcss";']);
  });

  it("excludes the pinned modules", () => {
    expect(list(options()["exclude"]).toSorted()).toEqual(
      ["checkbox", "radio", "rootscrollgutter", "rootscrolllock", "scrollbar"].toSorted(),
    );
  });
});

describe("main.tsx", () => {
  it("imports the app stylesheet after the framework entry and after KaTeX", () => {
    const entry = entrySource.indexOf('"./daisyui.css"');
    const katex = entrySource.indexOf('"katex/dist/katex.min.css"');
    const app = entrySource.indexOf('"./styles.css"');

    expect(entry).toBeGreaterThanOrEqual(0);
    expect(app).toBeGreaterThan(entry);
    expect(app).toBeGreaterThan(katex);
  });
});
