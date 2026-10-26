import type { Element, ElementContent } from "hast";
import { describe, expect, it } from "vitest";

import { sanitizeFragment } from "./raw-html.ts";

const KATEX_FRAGMENT =
  '<span class="katex"><span class="katex-mathml"><math xmlns="http://www.w3.org/1998/Math/MathML"><semantics><mrow><mi>E</mi><mo>=</mo><mi>m</mi><msup><mi>c</mi><mn>2</mn></msup></mrow><annotation encoding="application/x-tex">E = mc^2</annotation></semantics></math></span><span class="katex-html" aria-hidden="true"><span class="katex-base"><span class="mord mathnormal">E</span></span></span></span>';

const SVG_FRAGMENT =
  '<span class="katex-stretchy"><svg xmlns="http://www.w3.org/2000/svg" width="0.875em" height="2.4em" viewBox="0 0 875 2400" preserveAspectRatio="xMinYMin"><path d="M0 0h875v240H0z"/></svg></span>';

const FOOTNOTE_FRAGMENT =
  '<sup class="footnote-ref"><a href="#footnote1">[1]</a><a class="footnote-anchor" id="footnote-ref1"></a></sup>';

const collect = (nodes: readonly ElementContent[], tagName: string): Element[] => {
  const found: Element[] = [];
  for (const node of nodes) {
    if (node.type !== "element") continue;
    if (node.tagName === tagName) found.push(node);
    found.push(...collect(node.children, tagName));
  }
  return found;
};

const allElements = (nodes: readonly ElementContent[]): Element[] => {
  const found: Element[] = [];
  for (const node of nodes) {
    if (node.type !== "element") continue;
    found.push(node, ...allElements(node.children));
  }
  return found;
};

const textOf = (nodes: readonly ElementContent[]): string =>
  nodes
    .map((node) => {
      if (node.type === "text") return node.value;
      return node.type === "element" ? textOf(node.children) : "";
    })
    .join("");

const first = (nodes: readonly ElementContent[], tagName: string): Element | undefined =>
  collect(nodes, tagName)[0];

const styleOf = (nodes: readonly ElementContent[], tagName: string): string => {
  const style = first(nodes, tagName)?.properties.style;
  return typeof style === "string" ? style : "";
};

describe("sanitizeFragment on generated origin", () => {
  it("keeps KaTeX's MathML structure", () => {
    const nodes = sanitizeFragment(KATEX_FRAGMENT, "generated");

    expect(first(nodes, "math")?.properties.xmlns).toBe("http://www.w3.org/1998/Math/MathML");
    for (const name of ["semantics", "mrow", "mi", "mo", "msup", "mn"]) {
      expect(collect(nodes, name).length).toBeGreaterThan(0);
    }
    expect(first(nodes, "annotation")?.properties.encoding).toBe("application/x-tex");
    expect(first(nodes, "annotation")?.children).toEqual([
      expect.objectContaining({ type: "text", value: "E = mc^2" }),
    ]);
    expect(
      collect(nodes, "span").some((span) => span.properties.className?.includes("katex-mathml")),
    ).toBe(true);
    const hidden = collect(nodes, "span").find((span) =>
      span.properties.className?.includes("katex-html"),
    );
    expect(hidden?.properties.ariaHidden).toBe("true");
  });

  it("keeps KaTeX's SVG geometry", () => {
    const nodes = sanitizeFragment(SVG_FRAGMENT, "generated");
    const svg = first(nodes, "svg");

    expect(svg?.properties.xmlns).toBe("http://www.w3.org/2000/svg");
    expect(svg?.properties.width).toBe("0.875em");
    expect(svg?.properties.height).toBe("2.4em");
    expect(svg?.properties.viewBox).toBe("0 0 875 2400");
    expect(svg?.properties.preserveAspectRatio).toBe("xMinYMin");
    expect(first(nodes, "path")?.properties.d).toBe("M0 0h875v240H0z");
    expect(first(nodes, "span")?.properties.className).toEqual(["katex-stretchy"]);
  });

  it("keeps the footnote href and id pair and their classes", () => {
    const nodes = sanitizeFragment(FOOTNOTE_FRAGMENT, "generated");
    const anchors = collect(nodes, "a");

    expect(anchors[0]?.properties.href).toBe("#footnote1");
    expect(anchors[1]?.properties.id).toBe("footnote-ref1");
    expect(first(nodes, "sup")?.properties.className).toEqual(["footnote-ref"]);
    expect(anchors[1]?.properties.className).toEqual(["footnote-anchor"]);
  });

  it("keeps role and ariaHidden", () => {
    const nodes = sanitizeFragment(
      '<span role="doc-noteref" aria-hidden="true">a</span>',
      "generated",
    );

    expect(first(nodes, "span")?.properties.role).toBe("doc-noteref");
    expect(first(nodes, "span")?.properties.ariaHidden).toBe("true");
  });
});

describe("sanitizeFragment on raw origin", () => {
  it("loses every generated name in a KaTeX fragment", () => {
    const nodes = sanitizeFragment(KATEX_FRAGMENT);

    for (const name of ["math", "semantics", "mrow", "mi", "mo", "msup", "mn", "annotation"]) {
      expect(collect(nodes, name)).toEqual([]);
    }
    for (const span of collect(nodes, "span")) {
      expect(span.properties.className).toBeUndefined();
      expect(span.properties.ariaHidden).toBeUndefined();
      expect(span.properties.style).toBeUndefined();
    }
    expect(textOf(nodes)).toContain("E = mc^2");
  });

  it("unwraps an SVG fragment", () => {
    const nodes = sanitizeFragment(SVG_FRAGMENT);

    expect(collect(nodes, "svg")).toEqual([]);
    expect(collect(nodes, "path")).toEqual([]);
    expect(first(nodes, "span")?.properties.className).toBeUndefined();
    expect(first(nodes, "span")?.properties.viewBox).toBeUndefined();
  });

  it("clobbers a footnote id and drops its classes", () => {
    const nodes = sanitizeFragment(FOOTNOTE_FRAGMENT);
    const anchors = collect(nodes, "a");

    expect(anchors[1]?.properties.id).toBe("user-content-footnote-ref1");
    expect(anchors[0]?.properties.className).toBeUndefined();
    expect(first(nodes, "sup")?.properties.className).toBeUndefined();
    expect(anchors[0]?.properties.href).toBe("#footnote1");
  });

  it("drops role and ariaHidden", () => {
    const nodes = sanitizeFragment('<span role="doc-noteref" aria-hidden="true">a</span>');

    expect(first(nodes, "span")?.properties.role).toBeUndefined();
    expect(first(nodes, "span")?.properties.ariaHidden).toBeUndefined();
  });
});

describe("sanitizeFragment on both origins", () => {
  const unsafe = [
    { fragment: "<script>alert(1)</script>after", tagName: "script" },
    { fragment: '<a onclick="x()">a</a>after', tagName: "a" },
    { fragment: '<iframe src="https://example.com"></iframe>after', tagName: "iframe" },
    { fragment: '<object data="x"></object>after', tagName: "object" },
  ];

  for (const origin of ["raw", "generated"] as const) {
    it(`strips scripts, handlers, iframes, and objects on ${origin}`, () => {
      for (const { fragment } of unsafe) {
        const nodes = sanitizeFragment(fragment, origin);

        expect(collect(nodes, "script")).toEqual([]);
        expect(collect(nodes, "iframe")).toEqual([]);
        expect(collect(nodes, "object")).toEqual([]);
        for (const element of allElements(nodes)) {
          for (const key of Object.keys(element.properties)) {
            expect(key.startsWith("on")).toBe(false);
          }
        }
        expect(textOf(nodes)).toContain("after");
      }
    });
  }

  it("does not admit a nav on either origin", () => {
    const fragment =
      '<nav class="table-of-contents"><ul><li><a href="#later">Later</a></li></ul></nav>';

    for (const origin of ["raw", "generated"] as const) {
      const nodes = sanitizeFragment(fragment, origin);

      expect(collect(nodes, "nav")).toEqual([]);
      for (const element of allElements(nodes)) {
        expect(element.properties.className).toBeUndefined();
      }
      expect(textOf(nodes)).toBe("Later");
    }
  });
});

describe("the generated style filter", () => {
  it("keeps KaTeX layout declarations", () => {
    const nodes = sanitizeFragment(
      '<span style="height:0.6833em;vertical-align:-0.25em">x</span>',
      "generated",
    );
    const style = styleOf(nodes, "span");

    expect(style).toContain("height");
    expect(style).toContain("vertical-align");
  });

  it("deletes style when every declaration is dropped", () => {
    const nodes = sanitizeFragment('<span style="position:fixed">x</span>', "generated");

    expect(first(nodes, "span")?.properties.style).toBeUndefined();
  });

  it("drops a non-transparent colour", () => {
    const nodes = sanitizeFragment('<span style="color:#cc0000">x</span>', "generated");

    expect(first(nodes, "span")?.properties.style).toBeUndefined();
  });

  it("keeps a transparent colour", () => {
    const nodes = sanitizeFragment('<span style="color:transparent">x</span>', "generated");
    const style = styleOf(nodes, "span");

    expect(style).toContain("color");
    expect(style).toContain("transparent");
  });

  it("keeps only the allowed declarations of a mixed style", () => {
    const nodes = sanitizeFragment(
      '<span style="height:1em;position:fixed;color:red">x</span>',
      "generated",
    );
    const style = styleOf(nodes, "span");

    expect(style).toContain("height");
    expect(style).not.toContain("position");
    expect(style).not.toContain("color");
  });
});
