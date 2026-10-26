import MarkdownIt from "markdown-it";
import { describe, expect, it } from "vitest";

import { readFrontMatter } from "./front-matter.ts";

describe("readFrontMatter", () => {
  it("splits a leading YAML block and keeps the body's line numbers", () => {
    const source = "---\ntitle: Kitchen Sink\nkeywords: [a, b]\n---\n# Kitchen Sink\n";

    const frontMatter = readFrontMatter(source);

    expect(frontMatter).not.toBeNull();
    expect(frontMatter?.range).toEqual({ startLine: 1, endLine: 4 });
    expect(frontMatter?.title).toBe("Kitchen Sink");

    const tokens = new MarkdownIt().parse(frontMatter?.body ?? "", {});
    expect(tokens[0]?.map).toEqual([4, 5]);
  });

  it("returns null when the file has no front matter", () => {
    expect(readFrontMatter("# Hi\n\ntext")).toBeNull();
  });

  it("returns a null title for malformed YAML without throwing", () => {
    const frontMatter = readFrontMatter("---\ntitle: [unclosed\n---\nbody");

    expect(frontMatter?.title).toBeNull();
    expect(frontMatter?.range).toEqual({ startLine: 1, endLine: 3 });
    expect(frontMatter?.body).toBe("\n\n\nbody");
  });

  it("returns a null title when title is not a string", () => {
    const frontMatter = readFrontMatter("---\ntitle: 42\n---\nbody");

    expect(frontMatter?.title).toBeNull();
    expect(frontMatter?.range).toEqual({ startLine: 1, endLine: 3 });
    expect(frontMatter?.body).toBe("\n\n\nbody");
  });
});
