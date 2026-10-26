// @effect-diagnostics asyncFunction:off
import type { BlockId, WireBlock } from "@mdv/core/protocol";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { BlockList } from "./blocks.tsx";
import { readTree, toReactProperties } from "./hast.tsx";

const block = (id: string, kind: WireBlock["kind"], hast: WireBlock["hast"]): WireBlock => ({
  id: id as BlockId,
  hash: `${id}-hash`,
  kind,
  range: { startLine: 1, endLine: 1 },
  hast,
});

const paragraphOf = (id: string, text: string): WireBlock =>
  block(id, "paragraph", [
    {
      type: "element",
      tagName: "p",
      properties: {},
      children: [{ type: "text", value: text }],
    },
  ]);

const headingOf = (id: string, text: string): WireBlock =>
  block(id, "heading", [
    {
      type: "element",
      tagName: "h2",
      properties: { id: "heading" },
      children: [{ type: "text", value: text }],
    },
  ]);

const frontMatterOf = (): WireBlock =>
  block("front", "frontMatter", [{ type: "text", value: "title: Hidden" }]);

const codeOf = (): WireBlock =>
  block("code", "code", [
    {
      type: "element",
      tagName: "pre",
      properties: {
        className: ["shiki", "shiki-themes"],
        style: "--shiki-light:#fff;--shiki-dark:#000;background-color:#eee",
      },
      children: [
        {
          type: "element",
          tagName: "code",
          properties: {},
          children: [{ type: "text", value: "const x = 1;" }],
        },
      ],
    },
  ]);

const fixtures = [
  headingOf("heading", "Heading"),
  paragraphOf("first", "First paragraph"),
  paragraphOf("second", "Second paragraph"),
  codeOf(),
];

const markupOf = (blocks: readonly WireBlock[]): string =>
  renderToStaticMarkup(
    <BlockList
      order={blocks.map((entry) => entry.id)}
      blocks={new Map(blocks.map((entry) => [entry.id, entry] as const))}
    />,
  );

describe("BlockList", () => {
  it("renders one element per ordered block", () => {
    const markup = markupOf(fixtures);

    expect(markup.indexOf("Heading")).toBeLessThan(markup.indexOf("First paragraph"));
    expect(markup.indexOf("First paragraph")).toBeLessThan(markup.indexOf("Second paragraph"));
    expect((markup.match(/data-block-id=/gu) ?? []).length).toBe(fixtures.length);
  });

  it("renders nothing for a front-matter block", () => {
    const markup = markupOf([frontMatterOf(), paragraphOf("a", "Visible")]);

    expect(markup).not.toContain("title: Hidden");
    expect(markup).toContain("Visible");
  });

  it("renders a code block's pre subtree with both theme variables", () => {
    const markup = markupOf([codeOf()]);

    expect(markup).toContain("--shiki-light");
    expect(markup).toContain("--shiki-dark");
  });

  it("maps a Shiki style string to a React style object", () => {
    const markup = markupOf([codeOf()]);

    expect(markup).toContain("--shiki-light:#fff");
    expect(markup).toContain("--shiki-dark:#000");
    expect(markup).toContain("background-color:#eee");
    expect(toReactProperties({ style: "background-color:#fff;--x:y" })).toEqual({
      style: { backgroundColor: "#fff", "--x": "y" },
    });
  });

  it("joins array-valued class names", () => {
    expect(markupOf([codeOf()])).toContain('class="shiki shiki-themes"');
  });

  it("drops an event-handler property", () => {
    const markup = markupOf([
      block("handler", "paragraph", [
        {
          type: "element",
          tagName: "p",
          properties: { onClick: "alert(1)" },
          children: [{ type: "text", value: "safe" }],
        },
      ]),
    ]);

    expect(markup).not.toContain("onclick");
    expect(markup).toContain("safe");
  });

  it("returns null from readTree for a non-object node", () => {
    expect(readTree([{ type: "nope" }])).toBeNull();
    expect(readTree({ type: "text", value: "x" })).toBeNull();
    expect(readTree("text")).toBeNull();
  });

  it("returns the tree from readTree for a valid subtree", () => {
    const tree = [
      {
        type: "element" as const,
        tagName: "p",
        properties: {},
        children: [{ type: "text" as const, value: "hi" }],
      },
    ];

    expect(readTree(tree)).toBe(tree);
  });

  it("pins the markup of the fixture set", async () => {
    await expect(markupOf(fixtures)).toMatchFileSnapshot("__snapshots__/blocks.html");
  });
});

describe("generated block markup", () => {
  it("renders a KaTeX-shaped block with its MathML copy hidden and its SVG geometry", () => {
    const katex = block("math", "math", [
      {
        type: "element",
        tagName: "span",
        properties: { className: ["katex"] },
        children: [
          {
            type: "element",
            tagName: "span",
            properties: { className: ["katex-html"], ariaHidden: "true" },
            children: [
              {
                type: "element",
                tagName: "svg",
                properties: { viewBox: "0 0 875 2400", preserveAspectRatio: "xMinYMin" },
                children: [
                  {
                    type: "element",
                    tagName: "path",
                    properties: { d: "M0 0h1v1z" },
                  },
                ],
              },
            ],
          },
        ],
      },
    ]);
    const markup = renderToStaticMarkup(
      <BlockList order={[katex.id]} blocks={new Map([[katex.id, katex]])} />,
    );

    expect(markup).toContain('aria-hidden="true"');
    expect(markup).toContain('viewBox="0 0 875 2400"');
    expect(markup).toContain('preserveAspectRatio="xMinYMin"');
    expect(markup).toContain('d="M0 0h1v1z"');
  });

  it("renders a nav with its label", () => {
    const toc = block("toc", "toc", [
      {
        type: "element",
        tagName: "nav",
        properties: { className: ["table-of-contents"], ariaLabel: "Table of contents" },
        children: [{ type: "text", value: "Later" }],
      },
    ]);
    const markup = renderToStaticMarkup(
      <BlockList order={[toc.id]} blocks={new Map([[toc.id, toc]])} />,
    );

    expect(markup).toContain('aria-label="Table of contents"');
  });
});
