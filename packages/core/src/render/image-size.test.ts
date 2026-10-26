import MarkdownIt from "markdown-it";
import { describe, expect, it } from "vitest";

import { createMarkdownIt } from "./blocks.ts";
import { parseImageSize } from "./image-size.ts";
import { defaultRenderOptions } from "./options.ts";

const markdownIt = createMarkdownIt(defaultRenderOptions);

describe("parseImageSize", () => {
  it("parses both dimensions", () => {
    expect(parseImageSize("=120x80")).toEqual({ width: 120, height: 80 });
  });

  it("parses a width alone and a height alone", () => {
    expect(parseImageSize("=120x")).toEqual({ width: 120, height: null });
    expect(parseImageSize("=x80")).toEqual({ width: null, height: 80 });
  });

  it("parses a bare number as the width", () => {
    expect(parseImageSize("=120")).toEqual({ width: 120, height: null });
  });

  it("allows spaces around the equals sign and around x", () => {
    expect(parseImageSize("= 120x80")).toEqual({ width: 120, height: 80 });
    expect(parseImageSize("=120 x 80")).toEqual({ width: 120, height: 80 });
  });

  it("ignores a zero or negative side", () => {
    expect(parseImageSize("=0x80")).toEqual({ width: null, height: 80 });
    expect(parseImageSize("=-1x80")).toEqual({ width: null, height: 80 });
  });

  it("returns null for anything else", () => {
    expect(parseImageSize("")).toBeNull();
    expect(parseImageSize("=abc")).toBeNull();
    expect(parseImageSize("120")).toBeNull();
    expect(parseImageSize("=0")).toBeNull();
  });
});

describe("the image-size rule", () => {
  /** The part of a parser this differential test reads. */
  type ShapeParser = {
    parse: (
      source: string,
      env: Record<string, unknown>,
    ) => readonly {
      readonly type: string;
      readonly tag: string;
      readonly attrs: readonly unknown[] | null;
      readonly content: string;
      readonly children: readonly { readonly type: string; readonly content: string }[] | null;
    }[];
  };

  /** The token shape, so two parser instances can be compared. */
  const shapeOf = (source: string, parser: ShapeParser = markdownIt) =>
    parser.parse(source, {}).map((token) => ({
      type: token.type,
      tag: token.tag,
      attrs: token.attrs,
      content: token.content,
      children: (token.children ?? []).map((child) => [child.type, child.content]),
    }));

  it("produces exactly markdown-it's tokens when no size spec is present", () => {
    const bare = new MarkdownIt({ html: true, linkify: true, breaks: false });
    const source = '![alt *text*](image.png "title")';

    expect(shapeOf(source)).toEqual(shapeOf(source, bare));
  });
});
