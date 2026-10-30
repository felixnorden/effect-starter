import { describe, expect, it } from "vitest";

import { previewTitle } from "./preview-title.ts";

describe("page title", () => {
  it("a user template wins with the basename in its name slot", () => {
    expect(
      previewTitle({
        template: "「${name}」",
        explicit: true,
        name: "notes.md",
        frontMatterTitle: "Notes",
      }),
    ).toBe("「notes.md」");
  });

  it("a front-matter title wins when the template is the default", () => {
    expect(
      previewTitle({
        template: "「${name}」",
        explicit: false,
        name: "notes.md",
        frontMatterTitle: "Notes",
      }),
    ).toBe("Notes");
  });

  it("the default template applies when neither exists", () => {
    expect(
      previewTitle({
        template: "「${name}」",
        explicit: false,
        name: "notes.md",
        frontMatterTitle: null,
      }),
    ).toBe("「notes.md」");
  });
});
