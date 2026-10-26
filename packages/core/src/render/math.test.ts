import type { Element, ElementContent, RootContent } from "hast";
import { fromHtml } from "hast-util-from-html";
import { describe, expect, it } from "vitest";

import { collectBlocks, createMarkdownIt } from "./blocks.ts";
import { renderMath } from "./math.ts";
import { defaultRenderOptions } from "./options.ts";
import { sanitizeFragment } from "./raw-html.ts";

const markdownIt = createMarkdownIt(defaultRenderOptions);

const collectBlocksOf = (source: string) => collectBlocks(markdownIt, source, defaultRenderOptions);

const classesOf = (element: Element | undefined): readonly string[] =>
  Array.isArray(element?.properties.className) ? element.properties.className : [];

const allElements = (nodes: readonly ElementContent[]): Element[] => {
  const found: Element[] = [];
  for (const node of nodes) {
    if (node.type !== "element") continue;
    found.push(node, ...allElements(node.children));
  }
  return found;
};

const hastOf = (source: string): ElementContent[] => {
  const block = collectBlocksOf(source)[0];
  return block !== undefined && "hast" in block ? block.hast : [];
};

describe("the math plugin's tokens", () => {
  it("emits math_inline inside a paragraph and math_block at level 0", () => {
    const inline = markdownIt.parse("a $x$ b", {});
    const paragraph = inline.find((token) => token.type === "inline");
    const block = markdownIt.parse("$$\nx=1\n$$", {});
    const mathBlock = block.find((token) => token.type === "math_block");

    expect(paragraph?.children?.map((child) => child.type)).toContain("math_inline");
    expect(mathBlock?.level).toBe(0);
    expect(mathBlock?.tag).toBe("math");
    expect(mathBlock?.map).not.toBeNull();
  });
});

describe("display math", () => {
  it("renders as one math block with a KaTeX display subtree", () => {
    const blocks = collectBlocksOf("$$\nx=1\n$$");

    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.kind).toBe("math");
    expect(blocks[0]?.range).toEqual({ startLine: 1, endLine: 3 });
    const display = allElements(hastOf("$$\nx=1\n$$")).find((element) =>
      classesOf(element).includes("katex-display"),
    );
    expect(display).toBeDefined();
  });

  it("keeps the MathML copy and the hidden HTML copy apart", () => {
    const elements = allElements(hastOf("$$\nx=1\n$$"));
    const math = elements.find((element) => element.tagName === "math");
    const htmlCopy = elements.find((element) => classesOf(element).includes("katex-html"));
    const mathmlCopy = elements.find((element) => classesOf(element).includes("katex-mathml"));
    const annotation = elements.find((element) => element.tagName === "annotation");

    expect(math).toBeDefined();
    expect(annotation?.properties.encoding).toBe("application/x-tex");
    expect(mathmlCopy).toBeDefined();
    expect(htmlCopy).toBeDefined();
    expect(htmlCopy?.properties.ariaHidden).toBe("true");
  });

  it("renders display mhchem", () => {
    const elements = allElements(hastOf("$$\n\\ce{H2O}\n$$"));
    const classes = elements.map((element) => classesOf(element));

    expect(classes.some((names) => names.includes("katex"))).toBe(true);
    expect(classes.some((names) => names.includes("katex-error"))).toBe(false);
    expect(elements.some((element) => element.tagName === "msub")).toBe(true);
  });
});

describe("inline math", () => {
  const textOfNodes = (nodes: readonly ElementContent[]): string =>
    nodes
      .map((node) => {
        if (node.type === "text") return node.value;
        return node.type === "element" ? textOfNodes(node.children) : "";
      })
      .join("");

  const inlineBlock = (source: string) => collectBlocksOf(source)[0];

  it("renders inline math in a paragraph", () => {
    const block = inlineBlock("text $E = mc^2$ end");
    const hast = block !== undefined && "hast" in block ? block.hast : [];
    const elements = allElements(hast);

    expect(block?.kind).toBe("paragraph");
    expect(elements.some((element) => classesOf(element).includes("katex"))).toBe(true);
    expect(elements.some((element) => element.tagName === "math")).toBe(true);
    expect(elements.filter((element) => classesOf(element).includes("katex-html"))).toHaveLength(1);
    expect(textOfNodes(hast)).not.toMatch(/[\uE000\uE001]/u);
  });

  it("keeps a strong wrapper around math", () => {
    const hast = hastOf("**a $x$ b**");
    const strong = allElements(hast).find((element) => element.tagName === "strong");
    const katex = allElements(strong?.children ?? []).find((element) =>
      classesOf(element).includes("katex"),
    );

    expect(strong).toBeDefined();
    expect(katex).toBeDefined();
    expect(textOfNodes(hast)).toContain("a");
    expect(textOfNodes(hast)).toContain("b");
    expect(textOfNodes(hast)).not.toMatch(/[\uE000\uE001]/u);
  });

  it("keeps a link wrapper around math", () => {
    const hast = hastOf("[see $x$](https://e.com)");
    const link = allElements(hast).find((element) => element.tagName === "a");
    const katex = allElements(link?.children ?? []).find((element) =>
      classesOf(element).includes("katex"),
    );

    expect(link?.properties.href).toBe("https://e.com");
    expect(katex).toBeDefined();
    expect(textOfNodes(link?.children ?? [])).toContain("see");
    expect(allElements(hast).filter((element) => element.tagName === "a")).toHaveLength(1);
  });

  it("keeps math inside a table cell", () => {
    const hast = hastOf("| a |\n| - |\n| $x$ |");
    const cell = allElements(hast).find((element) => element.tagName === "td");
    const katex = allElements(cell?.children ?? []).find((element) =>
      classesOf(element).includes("katex"),
    );

    expect(cell).toBeDefined();
    expect(katex).toBeDefined();
  });

  it("strips authored class and style in a paragraph that also contains math", () => {
    const hast = hastOf('<span class="x" style="color:red">a</span> and $x$');
    const spans = allElements(hast).filter((element) => element.tagName === "span");
    const authored = spans.find((element) => textOfNodes(element.children) === "a");
    const katex = spans.find((element) => classesOf(element).includes("katex"));

    expect(authored).toBeDefined();
    expect(authored?.properties.className).toBeUndefined();
    expect(authored?.properties.style).toBeUndefined();
    expect(katex).toBeDefined();
  });

  it("keeps an escaped dollar and a code span untouched", () => {
    const escaped = hastOf("costs \\$5");
    const code = hastOf("`$x$`");

    expect(textOfNodes(escaped)).toContain("$5");
    expect(allElements(escaped).some((element) => classesOf(element).includes("katex"))).toBe(
      false,
    );
    expect(allElements(code).some((element) => classesOf(element).includes("katex"))).toBe(false);
  });

  it("renders inline mhchem", () => {
    const elements = allElements(hastOf("$\\ce{H2O}$"));

    expect(elements.some((element) => classesOf(element).includes("katex"))).toBe(true);
    expect(elements.some((element) => classesOf(element).includes("katex-error"))).toBe(false);
    expect(elements.some((element) => element.tagName === "msub")).toBe(true);
  });

  it("turns a malformed formula into the plugin's katex-error span", () => {
    const elements = allElements(hastOf("$\\frac{1}$"));

    expect(elements.some((element) => classesOf(element).includes("katex-error"))).toBe(true);
  });

  it("renders an undefined control sequence as text without colour", () => {
    const elements = allElements(hastOf("$\\notacommand{}$"));
    const texts = elements.map((element) => textOfNodes(element.children));

    expect(elements.some((element) => classesOf(element).includes("katex"))).toBe(true);
    expect(elements.some((element) => classesOf(element).includes("katex-error"))).toBe(false);
    expect(texts.some((text) => text.includes("\\notacommand"))).toBe(true);
    for (const element of elements) {
      expect(String(element.properties.style ?? "")).not.toContain("color");
    }
  });

  it("removes the sentinel from authored text", () => {
    const hast = hastOf("\uE000 and $x$");
    const katex = allElements(hast).filter((element) => classesOf(element).includes("katex"));

    expect(textOfNodes(hast)).not.toMatch(/[\uE000\uE001]/u);
    expect(katex).toHaveLength(1);
  });

  it("renders a run without math through the unchanged plain path", () => {
    const source = "plain **bold** and `code` text";
    const inline = markdownIt.parse(source, {}).find((token) => token.type === "inline");
    const direct = sanitizeFragment(markdownIt.renderInline?.(inline?.children ?? [], {}) ?? "");
    const paragraph = allElements(hastOf(source)).find((element) => element.tagName === "p");

    expect(paragraph?.children).toEqual(direct);
  });
});

describe("the generated policy against a real KaTeX corpus", () => {
  /** Every `tag` and every `tag@property` pair in a tree, before or after sanitizing. */
  const pairsOf = (nodes: readonly RootContent[]): Set<string> => {
    const pairs = new Set<string>();
    const walk = (items: readonly RootContent[]): void => {
      for (const node of items) {
        if (node.type !== "element") continue;
        pairs.add(node.tagName);
        for (const key of Object.keys(node.properties)) pairs.add(`${node.tagName}@${key}`);
        walk(node.children);
      }
    };
    walk(nodes);
    return pairs;
  };

  /** Every declaration of every `style` attribute in a tree. */
  const declarationsOf = (nodes: readonly RootContent[]): string[] => {
    const declarations: string[] = [];
    const walk = (items: readonly RootContent[]): void => {
      for (const node of items) {
        if (node.type !== "element") continue;
        const style = node.properties.style;
        if (typeof style === "string") {
          for (const part of style.split(";")) {
            const declaration = part.trim();
            if (declaration !== "") declarations.push(declaration);
          }
        }
        walk(node.children);
      }
    };
    walk(nodes);
    return declarations;
  };

  /** The only declarations the filter may drop: the error red and hostile positioning. */
  const denied = (declaration: string): boolean =>
    declaration.replaceAll(" ", "") === "color:#cc0000" || declaration.startsWith("position");

  const corpus = [
    "x=1",
    "\\frac{a}{b}",
    "\\sqrt{x}",
    "\\sqrt[3]{x}",
    "\\left(\\frac{a}{b}\\right)",
    "\\left\\{ x \\right.",
    "\\phantom{x}",
    "\\begin{array}{cc}a&b\\\\c&d\\end{array}",
    "\\ce{H2O}",
    "\\hat{x}",
    "\\overbrace{x+y}",
    "\\underbrace{x+y}",
    "\\text{word}",
    "\\int_0^1 x",
    "\\sum_{i=1}^{n} i",
    "\\boxed{x}",
    "x^{a_b}",
  ];

  it("keeps every element and attribute the corpus emits", () => {
    const dropped: string[] = [];

    for (const tex of corpus) {
      const html = renderMath(tex, true);
      const before = pairsOf(fromHtml(html, { fragment: true }).children);
      const after = pairsOf(sanitizeFragment(html, "generated"));
      for (const pair of before) {
        if (!after.has(pair)) dropped.push(`${tex} drops ${pair}`);
      }
    }

    expect(dropped).toEqual([]);
  });

  it("keeps every style declaration that is not on the deny list", () => {
    const dropped: string[] = [];

    for (const tex of [...corpus, "\\notacommand{}", "\\frac{1}"]) {
      const html = renderMath(tex, false);
      const before = declarationsOf(fromHtml(html, { fragment: true }).children);
      const after = declarationsOf(sanitizeFragment(html, "generated"));
      const kept = [...after];
      for (const declaration of before) {
        const index = kept.indexOf(declaration);
        if (index === -1) {
          if (!denied(declaration)) dropped.push(`${tex} drops ${declaration}`);
        } else {
          kept.splice(index, 1);
        }
      }
    }

    expect(dropped).toEqual([]);
  });
});
