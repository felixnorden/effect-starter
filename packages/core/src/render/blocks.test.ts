import type { Element, ElementContent } from "hast";
import { describe, expect, it } from "vitest";

import { collectBlocks, createMarkdownIt, type MarkdownParser, type Token } from "./blocks.ts";
import { defaultRenderOptions } from "./options.ts";

const collect = (nodes: readonly ElementContent[], tagName: string): Element[] => {
  const found: Element[] = [];
  for (const node of nodes) {
    if (node.type !== "element") continue;
    if (node.tagName === tagName) found.push(node);
    found.push(...collect(node.children, tagName));
  }
  return found;
};

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

describe("collectBlocks", () => {
  const markdownIt = createMarkdownIt(defaultRenderOptions);

  it("gives every top-level block a 1-based inclusive range", () => {
    const body = [
      "# Heading",
      "",
      "paragraph line",
      "",
      "- item",
      "",
      "| a | b |",
      "| - | - |",
      "| 1 | 2 |",
      "",
      "```ts",
      "const x = 1;",
      "```",
      "",
      "---",
    ].join("\n");

    const blocks = collectBlocks(markdownIt, body, defaultRenderOptions);

    expect(blocks.map((block) => block.kind)).toEqual([
      "heading",
      "paragraph",
      "list",
      "table",
      "code",
      "thematicBreak",
    ]);
    expect(blocks.map((block) => block.range)).toEqual([
      { startLine: 1, endLine: 1 },
      { startLine: 3, endLine: 3 },
      { startLine: 5, endLine: 6 },
      { startLine: 7, endLine: 9 },
      { startLine: 11, endLine: 13 },
      { startLine: 15, endLine: 15 },
    ]);
  });

  it("pairs a level-0 open token with its close so a nested list is one block", () => {
    const body = "intro\n\n- one\n  - two";

    const blocks = collectBlocks(markdownIt, body, defaultRenderOptions);

    expect(blocks).toHaveLength(2);
    expect(blocks[1]?.kind).toBe("list");
    expect(blocks[1]?.range).toEqual({ startLine: 3, endLine: 4 });
  });

  it("drops a hidden token", () => {
    const inline = token({ type: "inline", level: 1, content: "text", map: [4, 5] });
    const stub: MarkdownParser = {
      parse: () => [
        token({ type: "front_matter", map: [0, 4], hidden: true }),
        token({ type: "paragraph_open", tag: "p", nesting: 1, map: [4, 5] }),
        inline,
        token({ type: "paragraph_close", tag: "p", nesting: -1 }),
      ],
      renderInline: (tokens) => tokens.map((entry) => entry.content).join(""),
    };

    const blocks = collectBlocks(stub, "body", defaultRenderOptions);

    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.range).toEqual({ startLine: 5, endLine: 5 });
  });

  it("renders a task-list item with a disabled checkbox", () => {
    const blocks = collectBlocks(markdownIt, "- [ ] todo\n- [x] done", defaultRenderOptions);
    const hast = blocks[0]?.kind === "list" ? blocks[0].hast : [];
    const list = collect(hast, "ul")[0];
    const inputs = collect(hast, "input");

    expect(list?.properties.className).toContain("contains-task-list");
    expect(inputs).toHaveLength(2);
    expect(inputs[0]?.properties).toMatchObject({ type: "checkbox", disabled: true });
    expect(inputs[0]?.properties.checked).not.toBe(true);
    expect(inputs[1]?.properties.checked).toBe(true);
  });

  it("gives duplicate headings distinct ids", () => {
    const blocks = collectBlocks(markdownIt, "## Same\n\n## Same", defaultRenderOptions);
    const ids = blocks.flatMap((block) =>
      block.kind === "heading" ? collect(block.hast, "h3") : [],
    );

    expect(ids.map((element) => element.properties.id)).toEqual(["same", "same-1"]);
  });

  it("slugs punctuation, Unicode, and empty headings", () => {
    const blocks = collectBlocks(
      markdownIt,
      "## Hello, World!\n\n## Héllo\n\n## !!!",
      defaultRenderOptions,
    );
    const ids = blocks.flatMap((block) =>
      block.kind === "heading" ? collect(block.hast, "h3") : [],
    );

    expect(ids.map((element) => element.properties.id)).toEqual([
      "hello-world",
      "héllo",
      "section",
    ]);
  });

  it("handles a suffix collision", () => {
    const blocks = collectBlocks(
      markdownIt,
      "## Same\n\n## Same\n\n## Same-1",
      defaultRenderOptions,
    );
    const ids = blocks.flatMap((block) =>
      block.kind === "heading" ? collect(block.hast, "h3") : [],
    );

    expect(ids.map((element) => element.properties.id)).toEqual(["same", "same-1", "same-1-1"]);
  });

  it("keeps a fence's raw code for the highlighting stage", () => {
    const blocks = collectBlocks(markdownIt, "```ts\nconst x = 1;\n```", defaultRenderOptions);
    const block = blocks[0];

    expect(block?.kind).toBe("code");
    expect(block).toMatchObject({ lang: "ts", code: "const x = 1;\n" });
    expect(block !== undefined && "hast" in block).toBe(false);
    expect(block?.range).toEqual({ startLine: 1, endLine: 3 });
  });

  it("keeps a raw HTML block as an unsanitized placeholder", () => {
    const blocks = collectBlocks(
      markdownIt,
      '<div class="x"><b>hi</b></div>',
      defaultRenderOptions,
    );
    const block = blocks[0];

    expect(block?.kind).toBe("html");
    expect(block).toMatchObject({ fragment: '<div class="x"><b>hi</b></div>' });
  });

  it("maps a table block although cells carry no map", () => {
    const blocks = collectBlocks(
      markdownIt,
      "| a | b |\n| - | - |\n| 1 | 2 |",
      defaultRenderOptions,
    );
    const block = blocks[0];

    expect(block?.kind).toBe("table");
    expect(block?.range).toEqual({ startLine: 1, endLine: 3 });
    expect(block?.kind === "table" ? collect(block.hast, "tr") : []).toHaveLength(2);
  });
});

describe("TOC markers", () => {
  const markdownIt = createMarkdownIt(defaultRenderOptions);

  const textOf = (nodes: readonly ElementContent[]): string =>
    nodes
      .map((node) => {
        if (node.type === "text") return node.value;
        return node.type === "element" ? textOf(node.children) : "";
      })
      .join("");

  const markerHrefs = (source: string, options = defaultRenderOptions): string[] => {
    const blocks = collectBlocks(markdownIt, source, options);
    return blocks.flatMap((block) =>
      block.kind === "toc"
        ? collect(block.hast, "a").map((link) => String(link.properties.href))
        : [],
    );
  };

  it("recognises all four markers in place", () => {
    for (const marker of ["${toc}", "[[toc]]", "[toc]", "[[_toc_]]"]) {
      const blocks = collectBlocks(markdownIt, `${marker}\n\n# Later`, defaultRenderOptions);

      expect(blocks).toHaveLength(2);
      expect(blocks[0]?.kind).toBe("toc");
      expect(blocks[0]?.kind === "toc" ? collect(blocks[0].hast, "nav") : []).toHaveLength(1);
      expect(markerHrefs(`${marker}\n\n# Later`)).toEqual(["#later"]);
    }
  });

  it("leaves the marker literal when the document has no headings", () => {
    const blocks = collectBlocks(markdownIt, "${toc}", defaultRenderOptions);
    const hast = blocks[0]?.kind === "paragraph" ? blocks[0].hast : [];

    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.kind).toBe("paragraph");
    expect(collect(hast, "nav")).toHaveLength(0);
    expect(textOf(hast)).toBe("${toc}");
  });

  it("leaves a marker inside emphasis literal", () => {
    const blocks = collectBlocks(markdownIt, "**${toc}**\n\n# Later", defaultRenderOptions);

    expect(blocks.map((block) => block.kind)).toEqual(["paragraph", "heading"]);
  });

  it("emits one TOC per marker", () => {
    const blocks = collectBlocks(markdownIt, "${toc}\n\n# Later\n\n[[toc]]", defaultRenderOptions);

    expect(blocks).toHaveLength(3);
    expect(blocks.filter((block) => block.kind === "toc")).toHaveLength(2);
    expect(markerHrefs("${toc}\n\n# Later\n\n[[toc]]")).toEqual(["#later", "#later"]);
  });

  it("takes the list type from the option record", () => {
    const blocks = collectBlocks(markdownIt, "${toc}\n\n# Later", {
      ...defaultRenderOptions,
      tocListType: "ul",
    });
    const nav = blocks[0]?.kind === "toc" ? collect(blocks[0].hast, "nav")[0] : undefined;

    expect(collect(nav?.children ?? [], "ul")).toHaveLength(1);
    expect(collect(nav?.children ?? [], "ol")).toHaveLength(0);
  });

  it("keeps a nested heading's id but not a TOC entry", () => {
    const blocks = collectBlocks(markdownIt, "> # Quoted\n\n# Top\n\n${toc}", defaultRenderOptions);
    const quoted = blocks[0]?.kind === "blockquote" ? collect(blocks[0].hast, "h2")[0] : undefined;

    expect(blocks.map((block) => block.kind)).toEqual(["blockquote", "heading", "toc"]);
    expect(quoted?.properties.id).toBe("quoted");
    expect(markerHrefs("> # Quoted\n\n# Top\n\n${toc}")).toEqual(["#top"]);
  });

  it("gives a heading the id the index minted", () => {
    const source = "## Same\n\n${toc}\n\n## Same";
    const blocks = collectBlocks(markdownIt, source, defaultRenderOptions);
    const headingIds = blocks.flatMap((block) =>
      block.kind === "heading" ? collect(block.hast, "h3") : [],
    );

    expect(headingIds.map((heading) => heading.properties.id)).toEqual(["same", "same-1"]);
    expect(markerHrefs(source)).toEqual(["#same", "#same-1"]);
  });

  it("labels a second TOC uniquely", () => {
    const blocks = collectBlocks(markdownIt, "${toc}\n\n[[toc]]\n\n# Later", defaultRenderOptions);
    const labels = blocks.flatMap((block) =>
      block.kind === "toc" ? collect(block.hast, "nav") : [],
    );

    expect(labels.map((nav) => nav.properties.ariaLabel)).toEqual([
      "Table of contents",
      "Table of contents 2",
    ]);
  });
});

describe("footnotes, definition lists, and emoji", () => {
  const markdownIt = createMarkdownIt(defaultRenderOptions);

  const blocksOf = (source: string) => collectBlocks(markdownIt, source, defaultRenderOptions);

  const allElements = (nodes: readonly ElementContent[]): Element[] => {
    const found: Element[] = [];
    for (const node of nodes) {
      if (node.type !== "element") continue;
      found.push(node, ...allElements(node.children));
    }
    return found;
  };

  it("renders a footnote reference and a section as two blocks", () => {
    const blocks = blocksOf("A[^note].\n\n[^note]: text\n");
    const section = blocks[1]?.kind === "footnote" ? blocks[1].hast : [];
    const reference = blocks[0]?.kind === "paragraph" ? collect(blocks[0].hast, "a")[0] : undefined;
    const backref = collect(section, "a").find((link) =>
      String(link.properties.className ?? "").includes("footnote-backref"),
    );

    expect(blocks.map((block) => block.kind)).toEqual(["paragraph", "footnote"]);
    expect(reference?.properties.href).toBe("#footnote1");
    expect(collect(section, "nav")).toHaveLength(0);
    expect(collect(section, "hr")).toHaveLength(1);
    expect(collect(section, "ol")).toHaveLength(1);
    expect(collect(section, "section")[0]?.properties.dataFootnotes).toBe("");
    expect(collect(section, "li")[0]?.properties.id).toBe("footnote1");
    expect(backref?.properties.href).toBe("#footnote-ref1");
  });

  it("gives every element in the footnote section a non-empty tag", () => {
    const blocks = blocksOf("A[^note].\n\n[^note]: text\n");
    const section = blocks[1]?.kind === "footnote" ? blocks[1].hast : [];

    expect(allElements(section).filter((element) => element.tagName === "")).toEqual([]);
  });

  it("gives the footnote section a range inside the document", () => {
    const source = "A[^note].\n\n[^note]: text\n";
    const blocks = blocksOf(source);
    const lineCount = source.split("\n").length;
    const range = blocks[1]?.range;

    expect(range?.startLine).toBeGreaterThanOrEqual(1);
    expect(range?.endLine).toBeLessThanOrEqual(lineCount);
    expect(range?.startLine).toBeLessThanOrEqual(3);
    expect(range?.endLine).toBeGreaterThanOrEqual(3);
  });

  it("strips authored HTML inside a definition", () => {
    const blocks = blocksOf(
      'A[^a].\n\n[^a]: note with <span class="x" style="color:red">raw</span>\n',
    );
    const section = blocks[1]?.kind === "footnote" ? blocks[1].hast : [];
    const span = allElements(section).find((element) => element.tagName === "span");

    expect(span).toBeDefined();
    expect(span?.properties.className).toBeUndefined();
    expect(span?.properties.style).toBeUndefined();
  });

  it("keeps a footnote reference inside emphasis", () => {
    const blocks = blocksOf("**see[^a]**\n\n[^a]: text\n");
    const hast = blocks[0]?.kind === "paragraph" ? blocks[0].hast : [];
    const strong = allElements(hast).find((element) => element.tagName === "strong");
    const sup = allElements(strong?.children ?? []).find((element) => element.tagName === "sup");

    expect(sup).toBeDefined();
  });

  it("keeps a definition list as one block", () => {
    const blocks = blocksOf("Term\n: definition");
    const hast = blocks[0]?.kind === "list" ? blocks[0].hast : [];

    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.kind).toBe("list");
    expect(collect(hast, "dl")).toHaveLength(1);
    expect(collect(hast, "dt")).toHaveLength(1);
    expect(collect(hast, "dd")).toHaveLength(1);
  });

  it("renders an emoji shortcode and leaves an unknown one literal", () => {
    const blocks = blocksOf(":tada: :notashortcode:");
    const hast = blocks[0]?.kind === "paragraph" ? blocks[0].hast : [];

    expect(JSON.stringify(hast)).toContain("🎉");
    expect(JSON.stringify(hast)).toContain(":notashortcode:");
  });

  it("reserves the footnote id family when the document has footnotes", () => {
    const blocks = blocksOf("# footnote1\n\nA[^a].\n\n[^a]: text\n");
    const heading = blocks[0]?.kind === "heading" ? collect(blocks[0].hast, "h2")[0] : undefined;
    const section = blocks[2]?.kind === "footnote" ? blocks[2].hast : [];

    expect(heading?.properties.id).toBe("footnote1-1");
    expect(collect(section, "li")[0]?.properties.id).toBe("footnote1");
  });

  it("keeps a heading id byte-identical when the document has no footnotes", () => {
    const blocks = blocksOf("# footnote1");
    const heading = blocks[0]?.kind === "heading" ? collect(blocks[0].hast, "h2")[0] : undefined;

    expect(heading?.properties.id).toBe("footnote1");
  });
});

describe("image sizes", () => {
  const markdownIt = createMarkdownIt(defaultRenderOptions);

  const imagesOf = (source: string): Element[] => {
    const blocks = collectBlocks(markdownIt, source, defaultRenderOptions);
    const hast = blocks[0] !== undefined && "hast" in blocks[0] ? blocks[0].hast : [];
    return collect(hast, "img");
  };

  it("adds both dimensions to an image", () => {
    const [image] = imagesOf("![p](../images/pixel.png =120x80)");

    expect(image?.properties.width).toBe(120);
    expect(image?.properties.height).toBe(80);
  });

  it("sets only one dimension for a one-sided spec", () => {
    const [widthOnly] = imagesOf("![p](../images/pixel.png =120x)");
    const [heightOnly] = imagesOf("![p](../images/pixel.png =x80)");

    expect(widthOnly?.properties.width).toBe(120);
    expect(widthOnly?.properties.height).toBeUndefined();
    expect(heightOnly?.properties.width).toBeUndefined();
    expect(heightOnly?.properties.height).toBe(80);
  });

  it("keeps a title before the spec", () => {
    const [image] = imagesOf('![p](../images/pixel.png "t" =120x80)');

    expect(image?.properties.title).toBe("t");
    expect(image?.properties.width).toBe(120);
    expect(image?.properties.height).toBe(80);
  });

  it("ignores zero, negative, and unparseable specs", () => {
    for (const spec of ["=0x0", "=-1x-1", "=abc"]) {
      const [image] = imagesOf(`![p](../images/pixel.png ${spec})`);

      expect(image).toBeDefined();
      expect(image?.properties.width).toBeUndefined();
      expect(image?.properties.height).toBeUndefined();
    }
  });

  it("leaves an unsized image untouched", () => {
    const [image] = imagesOf("![p](../images/pixel.png)");

    expect(image?.properties.src).toBe("../images/pixel.png");
    expect(image?.properties.width).toBeUndefined();
    expect(image?.properties.height).toBeUndefined();
  });

  it("falls through on invalid parens", () => {
    expect(imagesOf("![p](../images/pixel.png garbage)")).toEqual([]);
  });

  it("keeps the image inside a paragraph block", () => {
    const blocks = collectBlocks(
      markdownIt,
      "![p](../images/pixel.png =120x80)",
      defaultRenderOptions,
    );
    const hast = blocks[0]?.kind === "paragraph" ? blocks[0].hast : [];

    expect(blocks[0]?.kind).toBe("paragraph");
    expect(collect(hast, "p")).toHaveLength(1);
    expect(collect(hast, "img")).toHaveLength(1);
  });
});
