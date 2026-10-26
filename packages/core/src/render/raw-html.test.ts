import type { Element, ElementContent } from "hast";
import { describe, expect, it } from "vitest";

import { sanitizeFragment } from "./raw-html.ts";

const elements = (nodes: readonly ElementContent[]): Element[] =>
  nodes.filter((node): node is Element => node.type === "element");

const collect = (nodes: readonly ElementContent[], tagName: string): Element[] => {
  const found: Element[] = [];
  for (const node of nodes) {
    if (node.type !== "element") continue;
    if (node.tagName === tagName) found.push(node);
    found.push(...collect(node.children, tagName));
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

describe("sanitizeFragment", () => {
  it("removes scripts, event handlers, iframes, and objects", () => {
    const nodes = sanitizeFragment(
      '<script>alert(1)</script><iframe src="x"></iframe><object></object><a onclick="x()">a</a>',
    );

    expect(collect(nodes, "script")).toHaveLength(0);
    expect(collect(nodes, "iframe")).toHaveLength(0);
    expect(collect(nodes, "object")).toHaveLength(0);
    expect(collect(nodes, "a")[0]?.properties.onclick).toBeUndefined();
  });

  it("strips a javascript: href", () => {
    const nodes = sanitizeFragment('<a href="javascript:alert(1)">click</a>');

    expect(collect(nodes, "a")[0]?.properties.href).toBeUndefined();
  });

  it("keeps a data:image/png src and drops a data:text/html src", () => {
    const kept = sanitizeFragment('<img src="data:image/png;base64,AA">');
    const dropped = sanitizeFragment('<img src="data:text/html,<script>alert(1)</script>">');

    expect(collect(kept, "img")[0]?.properties.src).toBe("data:image/png;base64,AA");
    expect(collect(dropped, "img")[0]?.properties.src).toBeUndefined();
  });

  it("keeps a relative image src", () => {
    const nodes = sanitizeFragment('<img src="images/pixel.png">');

    expect(collect(nodes, "img")[0]?.properties.src).toBe("images/pixel.png");
  });

  it("closes a container per fragment so block boundaries survive", () => {
    const nodes = sanitizeFragment('<div class="open">');

    expect(elements(nodes)).toHaveLength(1);
    expect(collect(nodes, "div")[0]?.tagName).toBe("div");
    expect(nodes.some((node) => node.type !== "element" && node.type !== "text")).toBe(false);
  });

  it("prefixes an element id with user-content-", () => {
    const nodes = sanitizeFragment('<h2 id="x">t</h2>');

    expect(collect(nodes, "h2")[0]?.properties.id).toBe("user-content-x");
  });

  it("sanitizes a paired inline fragment as one unit", () => {
    const nodes = sanitizeFragment('a <b onclick="x()">bold</b> c');

    expect(collect(nodes, "b")[0]?.properties.onclick).toBeUndefined();
    expect(textOf(nodes)).toBe("a bold c");
  });

  it("sanitizes with the raw policy when no origin is given", () => {
    const nodes = sanitizeFragment(
      '<span class="x" style="color:red" role="note" aria-hidden="true">a</span>',
    );
    const span = collect(nodes, "span")[0];

    expect(span?.properties.className).toBeUndefined();
    expect(span?.properties.style).toBeUndefined();
    expect(span?.properties.role).toBeUndefined();
    expect(span?.properties.ariaHidden).toBeUndefined();
  });

  it("removes an inline script but keeps the surrounding text", () => {
    const nodes = sanitizeFragment("a <script>alert(1)</script> b");

    expect(collect(nodes, "script")).toHaveLength(0);
    expect(textOf(nodes)).toBe("a  b");
  });
});
