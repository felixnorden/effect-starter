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
        className: ["shiki", "mdv-roles"],
        style: "background-color:var(--mdv-background);color:var(--mdv-foreground)",
      },
      children: [
        {
          type: "element",
          tagName: "code",
          properties: {},
          children: [
            {
              type: "element",
              tagName: "span",
              properties: { style: "color:var(--mdv-token-keyword)" },
              children: [{ type: "text", value: "const" }],
            },
            { type: "text", value: " x = 1;" },
          ],
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

  it("renders a code block's pre subtree with role variables", () => {
    const markup = markupOf([codeOf()]);

    expect(markup).toContain("var(--mdv-background)");
    expect(markup).toContain("var(--mdv-foreground)");
    expect(markup).toContain("var(--mdv-token-keyword)");
  });

  it("maps a Shiki style string to a React style object", () => {
    const markup = markupOf([codeOf()]);

    expect(markup).toContain("background-color:var(--mdv-background)");
    expect(markup).toContain("color:var(--mdv-foreground)");
    expect(toReactProperties({ style: "background-color:#fff;--x:y" })).toEqual({
      style: { backgroundColor: "#fff", "--x": "y" },
    });
  });

  it("joins array-valued class names", () => {
    expect(markupOf([codeOf()])).toContain('class="shiki mdv-roles"');
  });

  it("renders one control per heading, after the heading, nested included", () => {
    const withoutId = block("plainHeading", "heading", [
      {
        type: "element",
        tagName: "h2",
        properties: {},
        children: [{ type: "text", value: "No id" }],
      },
    ]);
    const nested = block("quote", "blockquote", [
      {
        type: "element",
        tagName: "blockquote",
        properties: {},
        children: [
          {
            type: "element",
            tagName: "h3",
            properties: { id: "nested" },
            children: [{ type: "text", value: "Nested" }],
          },
        ],
      },
    ]);

    const markup = markupOf([headingOf("heading", "Heading"), withoutId, nested]);

    expect(markup.match(/data-mdv-copy-link/gu)).toHaveLength(2);
    expect(markup).toContain('data-mdv-copy-link="heading"');
    expect(markup).toContain('data-mdv-copy-link="nested"');
    expect(markup).toContain('aria-label="Copy link to Heading"');
    expect(markup).toContain('<h2 id="heading">Heading</h2><button');
    expect(markup).not.toContain('data-mdv-copy-link="undefined"');
  });

  it("renders the control as a sibling of the block content", () => {
    const markup = markupOf([codeOf()]);
    const preEnd = markup.indexOf("</pre>");
    const button = markup.indexOf("data-mdv-copy-code");

    expect(markup).toContain('data-block-id="code"');
    expect(button).toBeGreaterThan(preEnd);
    expect(markup).toContain('aria-label="Copy code"');
    expect(markup.match(/data-mdv-copy-code/gu)).toHaveLength(1);
  });

  it("leaves a nested fence without a control", () => {
    const nested = block("quote", "blockquote", [
      {
        type: "element",
        tagName: "blockquote",
        properties: {},
        children: [
          {
            type: "element",
            tagName: "pre",
            properties: { className: ["shiki", "mdv-roles"] },
            children: [
              {
                type: "element",
                tagName: "code",
                properties: {},
                children: [{ type: "text", value: "nested" }],
              },
            ],
          },
        ],
      },
    ]);

    expect(markupOf([nested])).not.toContain("data-mdv-copy-code");
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
