import type { Element, ElementContent } from "hast";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { collectBlocks, createMarkdownIt } from "./blocks.ts";
import { readFrontMatter } from "./front-matter.ts";
import { defaultRenderOptions } from "./options.ts";

const fixture = readFileSync(
  new URL("../../../../fixtures/render-fidelity/heading-structure.md", import.meta.url),
  "utf8",
);

const markdownIt = createMarkdownIt(defaultRenderOptions);

const collect = (nodes: readonly ElementContent[], tagName: string): Element[] => {
  const found: Element[] = [];
  for (const node of nodes) {
    if (node.type !== "element") continue;
    if (node.tagName === tagName) found.push(node);
    found.push(...collect(node.children, tagName));
  }
  return found;
};

const HEADING_TAGS = ["h1", "h2", "h3", "h4", "h5", "h6"] as const;

/** Every heading element in the document, in document order. */
const headingsOf = (source: string): Element[] => {
  const headings: Element[] = [];
  for (const block of collectBlocks(markdownIt, source, defaultRenderOptions)) {
    if (block.kind !== "heading") continue;
    for (const tagName of HEADING_TAGS) headings.push(...collect(block.hast, tagName));
  }
  return headings;
};

/** The heading elements of one block, by the block's index in the document. */
const headingsOfBlock = (source: string, index: number): Element[] => {
  const block = collectBlocks(markdownIt, source, defaultRenderOptions)[index];
  if (block === undefined || block.kind !== "heading") return [];
  return HEADING_TAGS.flatMap((tagName) => collect(block.hast, tagName));
};

describe("heading demotion on the fixture", () => {
  it("demotes the fixture's source h1 to h2 and keeps its slug id", () => {
    const headings = headingsOf(fixture);

    expect(headings[0]?.tagName).toBe("h2");
    expect(headings[0]?.properties.id).toBe("document-head");
  });

  it("does not synthesise the fixture's skipped level", () => {
    const headings = headingsOfBlock(fixture, 2);

    expect(headings).toHaveLength(1);
    expect(headings[0]?.tagName).toBe("h4");
    expect(headings[0]?.properties.id).toBe("skipped-level");
  });

  it("leaves the fixture's h6 at h6 and produces no h7", () => {
    const headings = headingsOfBlock(fixture, 4);

    expect(headings).toHaveLength(1);
    expect(headings[0]?.tagName).toBe("h6");
    expect(headings[0]?.properties.id).toBe("deepest-level");
  });

  it("starts a document without front matter with a heading", () => {
    const blocks = collectBlocks(markdownIt, fixture, defaultRenderOptions);

    expect(readFrontMatter(fixture)).toBeNull();
    expect(blocks[0]?.kind).toBe("heading");
  });

  it("keeps duplicate ids stable across the demotion", () => {
    const headings = headingsOf("## Same\n\n## Same");

    expect(headings.map((heading) => heading.tagName)).toEqual(["h3", "h3"]);
    expect(headings.map((heading) => heading.properties.id)).toEqual(["same", "same-1"]);
  });
});
