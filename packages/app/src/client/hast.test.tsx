import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { HastNode, type HastNode as HastNodeType } from "./hast.tsx";

const markupOf = (tagName: string, properties: Record<string, unknown>): string =>
  renderToStaticMarkup(
    <HastNode
      node={
        {
          type: "element",
          tagName,
          properties,
        } satisfies HastNodeType
      }
    />,
  );

const attribute = (markup: string, name: string): string | undefined => {
  const match = new RegExp(`${name}="([^"]*)"`, "u").exec(markup);
  return match?.[1];
};

const image = (src: string): string => markupOf("img", { src, alt: "" });
const link = (href: string): string => markupOf("a", { href });

describe("reference mapping", () => {
  it("rewrites a relative image source onto the local route", () => {
    expect(attribute(image("images/pixel.png"), "src")).toBe("/local/images/pixel.png");
  });

  it("normalizes ./ and inner ../ segments before mapping", () => {
    expect(attribute(image("./images/pixel.png"), "src")).toBe("/local/images/pixel.png");
    expect(attribute(link("notes/../images/a.png"), "href")).toBe("/local/images/a.png");
  });

  it("drops a relative reference that escapes the root", () => {
    expect(attribute(image("../secret.png"), "src")).toBeUndefined();
    expect(attribute(link("images/../../secret.md"), "href")).toBeUndefined();
  });

  it("drops an absolute filesystem path", () => {
    expect(attribute(image("/etc/passwd"), "src")).toBeUndefined();
  });

  it("drops a percent-encoded escape and normalizes an inner one", () => {
    expect(attribute(image("images/%2e%2e/%2e%2e/secret.png"), "src")).toBeUndefined();
    expect(attribute(image("images/%2e%2e/a.png"), "src")).toBe("/local/a.png");
  });

  it("drops a decoded segment containing / and an invalid encoding", () => {
    expect(attribute(image("images/a%2Fb.png"), "src")).toBeUndefined();
    expect(attribute(image("images/%ZZ.png"), "src")).toBeUndefined();
  });

  it("normalizes backslashes and drops a Windows drive path", () => {
    expect(attribute(image("images\\pixel.png"), "src")).toBe("/local/images/pixel.png");
    expect(attribute(image("C:\\x.png"), "src")).toBeUndefined();
  });

  it("preserves a query and a fragment", () => {
    expect(attribute(image("images/a.png?v=2"), "src")).toBe("/local/images/a.png?v=2");
    expect(attribute(link("notes/a.md#x"), "href")).toBe("/local/notes/a.md#x");
  });

  it("passes a protocol-relative image source", () => {
    expect(attribute(image("//cdn.example.com/x.png"), "src")).toBe("//cdn.example.com/x.png");
  });

  it("passes a remote image source through unchanged", () => {
    expect(attribute(image("https://example.com/x.png"), "src")).toBe("https://example.com/x.png");
  });

  it("passes http, https, mailto, and protocol-relative hrefs through unchanged", () => {
    for (const href of [
      "http://example.com/x",
      "https://example.com/x",
      "mailto:someone@example.com",
      "//cdn.example.com/x",
    ]) {
      expect(attribute(link(href), "href")).toBe(href);
    }
  });

  it("passes a fragment href through unchanged", () => {
    expect(attribute(link("#same-1"), "href")).toBe("#same-1");
  });

  it("passes a data:image/ source through unchanged", () => {
    const src = "data:image/png;base64,AA";
    expect(attribute(image(src), "src")).toBe(src);
  });

  it("drops a javascript: href that reached the mapping", () => {
    expect(attribute(link("javascript:alert(1)"), "href")).toBeUndefined();
  });
});

describe("generated properties", () => {
  it("maps ariaHidden to aria-hidden", () => {
    const markup = markupOf("span", { ariaHidden: "true" });

    expect(attribute(markup, "aria-hidden")).toBe("true");
  });

  it("maps ariaLabel to aria-label", () => {
    const markup = markupOf("nav", { ariaLabel: "Table of contents" });

    expect(attribute(markup, "aria-label")).toBe("Table of contents");
    expect(markup).not.toContain("ariaLabel");
  });

  it("maps a camelCase data property to a hyphenated attribute", () => {
    const markup = markupOf("section", { dataFootnotes: "" });

    expect(markup).toContain('data-footnotes=""');
    expect(markup).not.toContain("dataFootnotes");
  });

  it("passes SVG geometry", () => {
    const svg = markupOf("svg", {
      viewBox: "0 0 875 2400",
      preserveAspectRatio: "xMinYMin",
    });
    const path = markupOf("path", { d: "M0 0h1v1z" });

    expect(attribute(svg, "viewBox")).toBe("0 0 875 2400");
    expect(attribute(svg, "preserveAspectRatio")).toBe("xMinYMin");
    expect(attribute(path, "d")).toBe("M0 0h1v1z");
  });

  it("keeps a hyphenated data or aria attribute", () => {
    const markup = markupOf("span", { "data-x": "1", "aria-hidden": "true" });

    expect(attribute(markup, "data-x")).toBe("1");
    expect(attribute(markup, "aria-hidden")).toBe("true");
  });

  it("keeps role and xmlns", () => {
    const markup = markupOf("math", { role: "math", xmlns: "http://www.w3.org/1998/Math/MathML" });

    expect(attribute(markup, "role")).toBe("math");
    expect(attribute(markup, "xmlns")).toBe("http://www.w3.org/1998/Math/MathML");
  });

  it("still drops an event handler and an unknown property", () => {
    const markup = markupOf("span", { onclick: "x()", unknownProp: "y" });

    expect(markup).not.toContain("onclick");
    expect(markup).not.toContain("unknownProp");
  });
});
