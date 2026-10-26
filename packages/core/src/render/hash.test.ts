import type { ElementContent } from "hast";
import { describe, expect, it } from "vitest";

import { hashBlock } from "./hash.ts";
import { optionsHash, defaultRenderOptions } from "./options.ts";

const text = (value: string): ElementContent => ({ type: "text", value });

const tree = (value: string): ElementContent[] => [
  {
    type: "element",
    tagName: "p",
    properties: {},
    children: [text(value)],
  },
];

const salt = optionsHash(defaultRenderOptions);

describe("hashBlock", () => {
  it("is stable for the same subtree and salt", () => {
    const first = hashBlock(tree("hello"), salt);
    const second = hashBlock(tree("hello"), salt);

    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f]{16}$/);
  });

  it("changes when the salt changes", () => {
    const otherSalt = optionsHash({ ...defaultRenderOptions, breaks: true });

    expect(hashBlock(tree("hello"), salt)).not.toBe(hashBlock(tree("hello"), otherSalt));
  });

  it("changes when the subtree text changes", () => {
    expect(hashBlock(tree("hello"), salt)).not.toBe(hashBlock(tree("hello!"), salt));
  });

  it("is order-sensitive", () => {
    const first = tree("a").concat(tree("b"));
    const second = tree("b").concat(tree("a"));

    expect(hashBlock(first, salt)).not.toBe(hashBlock(second, salt));
  });
});
