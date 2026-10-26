import type { Element, ElementContent } from "hast";
import { describe, expect, it } from "vitest";

import type { Token } from "./blocks.ts";
import { buildToc, headingText, isTocMarker, type HeadingEntry } from "./toc.ts";

const collect = (nodes: readonly ElementContent[], tagName: string): Element[] => {
  const found: Element[] = [];
  for (const node of nodes) {
    if (node.type !== "element") continue;
    if (node.tagName === tagName) found.push(node);
    found.push(...collect(node.children, tagName));
  }
  return found;
};

const entry = (overrides: Partial<HeadingEntry>): HeadingEntry => ({
  sourceLevel: 1,
  id: "id",
  text: "Text",
  topLevel: true,
  ...overrides,
});

const threeEntries = (): HeadingEntry[] => [
  entry({ sourceLevel: 1, id: "intro", text: "Intro" }),
  entry({ sourceLevel: 2, id: "setup", text: "Setup" }),
  entry({ sourceLevel: 3, id: "run", text: "Run" }),
];

const token = (overrides: Partial<Token>): Token => ({
  type: "",
  tag: "",
  nesting: 0,
  level: 0,
  map: null,
  hidden: false,
  content: "",
  info: "",
  markup: "",
  attrs: null,
  children: null,
  meta: null,
  ...overrides,
});

describe("isTocMarker", () => {
  it("accepts all four markers and trims", () => {
    expect(isTocMarker("${toc}")).toBe(true);
    expect(isTocMarker("[[toc]]")).toBe(true);
    expect(isTocMarker("[toc]")).toBe(true);
    expect(isTocMarker("[[_toc_]]")).toBe(true);
    expect(isTocMarker("  ${toc}  ")).toBe(true);
    expect(isTocMarker("a ${toc}")).toBe(false);
  });
});

describe("buildToc", () => {
  it("builds one nav with an ordered list and one link per entry", () => {
    const nav = buildToc(threeEntries(), "ol");
    const links = collect([nav as ElementContent].filter(Boolean), "a");

    expect(nav?.tagName).toBe("nav");
    expect(nav?.properties.className).toEqual(["table-of-contents"]);
    expect(nav?.properties.ariaLabel).toBe("Table of contents");
    expect(collect(nav?.children ?? [], "ol")).toHaveLength(1);
    expect(collect(nav?.children ?? [], "ul")).toHaveLength(0);
    expect(links.map((link) => link.properties.href)).toEqual(["#intro", "#setup", "#run"]);
  });

  it("uses a ul when the list type is ul", () => {
    const nav = buildToc(threeEntries(), "ul");

    expect(collect(nav?.children ?? [], "ul")).toHaveLength(1);
    expect(collect(nav?.children ?? [], "ol")).toHaveLength(0);
  });

  it("gives the second nav a unique label", () => {
    expect(buildToc(threeEntries(), "ol", 1)?.properties.ariaLabel).toBe("Table of contents");
    expect(buildToc(threeEntries(), "ol", 2)?.properties.ariaLabel).toBe("Table of contents 2");
  });

  it("excludes a source h4 entry", () => {
    const entries = [...threeEntries(), entry({ sourceLevel: 4, id: "deep", text: "Deep" })];
    const links = collect(buildToc(entries, "ol")?.children ?? [], "a");

    expect(links).toHaveLength(3);
    expect(links.map((link) => link.properties.href)).not.toContain("#deep");
  });

  it("excludes a nested entry", () => {
    const entries = [...threeEntries(), entry({ id: "nested", text: "Nested", topLevel: false })];
    const links = collect(buildToc(entries, "ol")?.children ?? [], "a");

    expect(links).toHaveLength(3);
    expect(links.map((link) => link.properties.href)).not.toContain("#nested");
  });

  it("links duplicate headings to their suffixed ids", () => {
    const entries = [entry({ id: "same", text: "Same" }), entry({ id: "same-1", text: "Same" })];
    const links = collect(buildToc(entries, "ol")?.children ?? [], "a");

    expect(links.map((link) => link.properties.href)).toEqual(["#same", "#same-1"]);
  });

  it("keeps one flat list when the source skips a level", () => {
    const entries = [entry({ sourceLevel: 1, id: "a" }), entry({ sourceLevel: 3, id: "b" })];
    const nav = buildToc(entries, "ol");

    expect(collect(nav?.children ?? [], "ol")).toHaveLength(1);
    expect(collect(nav?.children ?? [], "li")).toHaveLength(2);
    expect(collect(nav?.children ?? [], "ul")).toHaveLength(0);
  });

  it("returns null for an empty index", () => {
    expect(buildToc([], "ol")).toBeNull();
  });
});

describe("headingText", () => {
  it("reads text, code, math, and image alt", () => {
    const children = [
      token({ type: "text", content: "See " }),
      token({ type: "code_inline", content: "code" }),
      token({ type: "text", content: " and " }),
      token({ type: "math_inline", content: "x" }),
      token({ type: "image", content: "p" }),
      token({ type: "softbreak" }),
    ];

    expect(headingText(children)).toBe("See code and x p");
  });

  it("skips html and footnote tokens and collapses whitespace", () => {
    const children = [
      token({ type: "html_inline", content: "<b>" }),
      token({ type: "text", content: "  a   " }),
      token({ type: "footnote_ref" }),
      token({ type: "text", content: "  b  " }),
    ];

    expect(headingText(children)).toBe("a b");
    expect(headingText([])).toBe("");
  });
});
