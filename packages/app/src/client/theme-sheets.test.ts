import { describe, expect, it } from "vitest";

import { defaultDisplay, withTheme } from "./display.ts";
import { syncThemeSheets, type HeadDocument } from "./theme-sheets.ts";

type FakeLink = {
  readonly attributes: Map<string, string>;
  setAttribute(name: string, value: string): void;
  getAttribute(name: string): string | null;
};

const fakeStorage = () => {
  const data = new Map<string, string>();
  const storage = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
    clear: () => data.clear(),
    key: (index: number) => [...data.keys()][index] ?? null,
    get length() {
      return data.size;
    },
  };
  return storage as unknown as Storage;
};

const fakeLink = (): FakeLink => {
  const attributes = new Map<string, string>();
  return {
    attributes,
    setAttribute: (name, value) => void attributes.set(name, value),
    getAttribute: (name) => attributes.get(name) ?? null,
  };
};

const fakeHead = () => {
  const nodes: FakeLink[] = [];
  const doc = {
    head: { append: (element: unknown) => void nodes.push(element as FakeLink) },
    createElement: () => fakeLink(),
    querySelector: (selector: string) => {
      const slot = /data-mdv-theme-sheet="([^"]+)"/u.exec(selector)?.[1];
      return nodes.find((node) => node.attributes.get("data-mdv-theme-sheet") === slot) ?? null;
    },
  };
  const head = doc as unknown as HeadDocument;
  const hrefs = (): readonly (string | null)[] =>
    nodes.map((node) => node.getAttribute("href") ?? null);
  return { head, nodes, hrefs };
};

describe("syncThemeSheets", () => {
  it("creates one link per mode in the head, pointing at each slot's sheet", () => {
    const { head, nodes } = fakeHead();
    syncThemeSheets(head, defaultDisplay());

    expect(nodes).toHaveLength(2);
    expect(nodes.map((node) => node.attributes.get("data-mdv-theme-sheet"))).toEqual([
      "light",
      "dark",
    ]);
    for (const node of nodes) expect(node.getAttribute("rel")).toBe("stylesheet");
    expect(nodes.map((node) => node.getAttribute("href"))).toEqual([
      "/theme-sheets/github-light-high-contrast.css",
      "/theme-sheets/github-dark-high-contrast.css",
    ]);
  });

  it("updates the same two links in place, so old sheets never win the cascade", () => {
    const { head, nodes, hrefs } = fakeHead();
    const storage = fakeStorage();
    syncThemeSheets(head, defaultDisplay());

    const chosen = withTheme(
      withTheme(defaultDisplay(), "light", "light-plus", { storage }),
      "dark",
      "dark-plus",
      { storage },
    );
    syncThemeSheets(head, chosen);

    expect(nodes).toHaveLength(2);
    expect(hrefs()).toEqual(["/theme-sheets/light-plus.css", "/theme-sheets/dark-plus.css"]);

    // Going back to an earlier theme rewrites the same element again.
    syncThemeSheets(head, defaultDisplay());
    expect(nodes).toHaveLength(2);
    expect(hrefs()).toEqual([
      "/theme-sheets/github-light-high-contrast.css",
      "/theme-sheets/github-dark-high-contrast.css",
    ]);
  });

  it("leaves an unchanged href alone", () => {
    const { head, nodes } = fakeHead();
    syncThemeSheets(head, defaultDisplay());
    const [first] = nodes;
    syncThemeSheets(head, defaultDisplay());
    expect(nodes[0]).toBe(first);
    expect(nodes).toHaveLength(2);
  });
});
