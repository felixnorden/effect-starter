import { describe, expect, it } from "vitest";

import { defaultDisplay } from "./display.ts";
import { sheetLinks, type SheetLink } from "./session.ts";
import { syncThemeSheets, type HeadDocument } from "./theme-sheets.ts";

type FakeLink = {
  readonly attributes: Map<string, string>;
  setAttribute(name: string, value: string): void;
  getAttribute(name: string): string | null;
  remove(): void;
};

const fakeLink = (): FakeLink => {
  const attributes = new Map<string, string>();
  return {
    attributes,
    setAttribute: (name, value) => void attributes.set(name, value),
    getAttribute: (name) => attributes.get(name) ?? null,
    remove: () => {},
  };
};

const fakeHead = () => {
  const nodes: FakeLink[] = [];
  const doc = {
    head: {
      // Appending an attached node moves it, as the DOM does.
      append: (element: unknown) => {
        const link = element as FakeLink;
        const index = nodes.indexOf(link);
        if (index !== -1) nodes.splice(index, 1);
        nodes.push(link);
      },
    },
    createElement: () => {
      const link = fakeLink();
      link.remove = () => {
        const index = nodes.indexOf(link);
        if (index !== -1) nodes.splice(index, 1);
      };
      return link;
    },
    querySelector: (selector: string) => {
      const slot = /data-slot="([^"]+)"/u.exec(selector)?.[1];
      return nodes.find((node) => node.getAttribute("data-slot") === slot) ?? null;
    },
    querySelectorAll: () => [...nodes],
  };
  const head = doc as unknown as HeadDocument;
  const slots = (): readonly (string | null)[] =>
    nodes.map((node) => node.getAttribute("data-slot"));
  const hrefs = (): readonly (string | null)[] =>
    nodes.map((node) => node.getAttribute("href") ?? null);
  const linkOf = (slot: string): FakeLink | undefined =>
    nodes.find((node) => node.getAttribute("data-slot") === slot);
  return { head, nodes, slots, hrefs, linkOf };
};

/** The two mode sheets, without a session: the shape a plain page links. */
const modeLinks = (): readonly SheetLink[] => sheetLinks(defaultDisplay(), null);

/** A configured session: markdown first, code last, as the cascade requires. */
const configuredLinks = (): readonly SheetLink[] => [
  ...modeLinks(),
  { slot: "markdown", href: "/stylesheet/markdown/aaaaaaaaaaaaaaaa" },
  { slot: "code", href: "/stylesheet/code/bbbbbbbbbbbbbbbb" },
];

describe("syncThemeSheets", () => {
  it("creates one link per slot in the caller's order", () => {
    const { head, nodes, slots, hrefs } = fakeHead();
    syncThemeSheets(head, modeLinks());

    expect(nodes).toHaveLength(2);
    expect(slots()).toEqual(["light", "dark"]);
    for (const node of nodes) expect(node.getAttribute("rel")).toBe("stylesheet");
    expect(hrefs()).toEqual([
      "/theme-sheets/github-light-high-contrast.css",
      "/theme-sheets/github-dark-high-contrast.css",
    ]);
  });

  it("updates the same links in place, so old sheets never win the cascade", () => {
    const { head, nodes, hrefs, linkOf } = fakeHead();
    syncThemeSheets(head, modeLinks());
    const light = linkOf("light");
    const dark = linkOf("dark");

    syncThemeSheets(head, [
      { slot: "light", href: "/theme-sheets/light-plus.css" },
      { slot: "dark", href: "/theme-sheets/dark-plus.css" },
    ]);

    expect(nodes).toHaveLength(2);
    expect(linkOf("light")).toBe(light);
    expect(linkOf("dark")).toBe(dark);
    expect(hrefs()).toEqual(["/theme-sheets/light-plus.css", "/theme-sheets/dark-plus.css"]);

    // Going back to an earlier theme rewrites the same elements again.
    syncThemeSheets(head, modeLinks());
    expect(nodes).toHaveLength(2);
    expect(linkOf("light")).toBe(light);
    expect(linkOf("dark")).toBe(dark);
  });

  it("leaves an unchanged href alone", () => {
    const { head, linkOf } = fakeHead();
    syncThemeSheets(head, modeLinks());
    const before = linkOf("light")?.getAttribute("href");

    syncThemeSheets(head, modeLinks());
    expect(linkOf("light")?.getAttribute("href")).toBe(before);
  });

  it("keeps the configured sheets after the mode sheets, code last", () => {
    const { head, slots } = fakeHead();
    syncThemeSheets(head, configuredLinks());

    expect(slots()).toEqual(["light", "dark", "markdown", "code"]);
  });

  it("drops a configured link the session stops naming", () => {
    const { head, nodes, slots, hrefs } = fakeHead();
    syncThemeSheets(head, configuredLinks());
    syncThemeSheets(head, modeLinks());

    expect(nodes).toHaveLength(2);
    expect(slots()).toEqual(["light", "dark"]);
    expect(hrefs()).toEqual([
      "/theme-sheets/github-light-high-contrast.css",
      "/theme-sheets/github-dark-high-contrast.css",
    ]);
  });

  it("moves a link that arrives after a later slot into cascade order", () => {
    const { head, slots } = fakeHead();
    // The code sheet arrives first; the markdown sheet must still precede it.
    syncThemeSheets(head, [...modeLinks(), { slot: "code", href: "/stylesheet/code/1" }]);
    expect(slots()).toEqual(["light", "dark", "code"]);

    syncThemeSheets(head, configuredLinks());
    expect(slots()).toEqual(["light", "dark", "markdown", "code"]);
  });
});
