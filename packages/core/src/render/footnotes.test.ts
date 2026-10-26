import { describe, expect, it } from "vitest";

import { createMarkdownIt, type Token } from "./blocks.ts";
import {
  footnoteSectionRange,
  isFootnoteInlineToken,
  isFootnoteSectionToken,
  isTransparentContainer,
} from "./footnotes.ts";
import { defaultRenderOptions } from "./options.ts";

const markdownIt = createMarkdownIt(defaultRenderOptions);

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

describe("the footnote plugin's tokens", () => {
  const source = "A[^x].\n\n[^x]: Note.\n";
  const tokens = markdownIt.parse(source, {});

  it("gives the section and item tokens the shapes the walker matches", () => {
    const blockOpen = tokens.find((entry) => entry.type === "footnote_block_open");
    const itemOpen = tokens.find((entry) => entry.type === "footnote_open");

    expect(blockOpen?.tag).toBe("");
    expect(blockOpen?.level).toBe(0);
    expect(itemOpen?.tag).toBe("");
    expect(itemOpen?.level).toBe(0);
    expect(itemOpen?.meta?.id).toBe(0);
  });

  it("emits the anchor as a level-0 leaf between the inline token and the paragraph close", () => {
    const anchorIndex = tokens.findIndex((entry) => entry.type === "footnote_anchor");
    const anchor = tokens[anchorIndex];
    const inlineIndex = tokens.findIndex(
      (entry, index) => entry.type === "inline" && index < anchorIndex,
    );

    expect(anchor?.tag).toBe("");
    expect(anchor?.level).toBe(0);
    expect(anchor?.nesting).toBe(0);
    expect(anchorIndex).toBeGreaterThan(inlineIndex);
    expect(tokens[anchorIndex + 1]?.type).toBe("paragraph_close");
  });

  it("gives the moved definition paragraph a non-null map", () => {
    const paragraph = tokens.find((entry) => entry.type === "paragraph_open" && entry.level === 2);

    expect(paragraph?.map).not.toBeNull();
  });
});

describe("footnoteSectionRange", () => {
  it("returns the union of every non-null map in the group", () => {
    const tokens = [token({ map: [10, 11] }), token({ map: [12, 13] }), token({ map: null })];

    expect(footnoteSectionRange(tokens)).toEqual({ startLine: 11, endLine: 13 });
  });

  it("returns null when no token carries a map", () => {
    expect(footnoteSectionRange([token({ map: null })])).toBeNull();
  });
});

describe("footnote token predicates", () => {
  it("treats an empty-tag nesting token as transparent", () => {
    expect(isTransparentContainer({ tag: "", nesting: 1 })).toBe(true);
    expect(isTransparentContainer({ tag: "", nesting: -1 })).toBe(true);
    expect(isTransparentContainer({ tag: "section", nesting: 1 })).toBe(false);
  });

  it("recognises the two families", () => {
    expect(isFootnoteSectionToken("footnote_block_open")).toBe(true);
    expect(isFootnoteSectionToken("footnote_open")).toBe(true);
    expect(isFootnoteInlineToken("footnote_ref")).toBe(true);
    expect(isFootnoteInlineToken("footnote_anchor")).toBe(false);
    expect(isFootnoteSectionToken("paragraph_open")).toBe(false);
  });
});
