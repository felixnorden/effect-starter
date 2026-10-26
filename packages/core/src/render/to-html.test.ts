import type { DocumentModel } from "./document.ts";
import { describe, expect, it } from "vitest";

import { blockToHtml, documentToHtml } from "./to-html.ts";

const document: DocumentModel = {
  title: "Kitchen Sink",
  optionsHash: "0123456789abcdef",
  blocks: [
    {
      kind: "frontMatter",
      range: { startLine: 1, endLine: 4 },
      hash: "aaaaaaaaaaaaaaaa",
      hast: [],
    },
    {
      kind: "heading",
      range: { startLine: 5, endLine: 5 },
      hash: "bbbbbbbbbbbbbbbb",
      hast: [
        {
          type: "element",
          tagName: "h1",
          properties: { id: "kitchen-sink" },
          children: [{ type: "text", value: "Kitchen Sink" }],
        },
      ],
    },
    {
      kind: "paragraph",
      range: { startLine: 7, endLine: 8 },
      hash: "cccccccccccccccc",
      hast: [
        {
          type: "element",
          tagName: "p",
          properties: {},
          children: [{ type: "text", value: "first line\nsecond line" }],
        },
      ],
    },
  ],
};

describe("documentToHtml", () => {
  it("serializes every block in order", () => {
    const html = documentToHtml(document);

    expect(html.startsWith('<h1 id="kitchen-sink">Kitchen Sink</h1>')).toBe(true);
    expect(html).not.toContain("Kitchen Sink\n---");
    expect(html.indexOf("<h1")).toBeLessThan(html.indexOf("<p>"));
  });

  it("omits front-matter text", () => {
    expect(documentToHtml(document)).not.toContain("frontMatter");
  });
});

describe("blockToHtml", () => {
  it("collapses a block to one line", () => {
    const preview = blockToHtml(document.blocks[2]!);

    expect(preview).not.toContain("\n");
    expect(preview).toContain("first line second line");
  });
});
