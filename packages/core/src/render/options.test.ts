import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import { defaultRenderOptions, optionsHash, RenderOptionsSchema } from "./options.ts";

describe("optionsHash", () => {
  it("is stable for the same record and changes when one option changes", () => {
    const a = optionsHash(defaultRenderOptions);
    const a2 = optionsHash({ ...defaultRenderOptions });
    const b = optionsHash({ ...defaultRenderOptions, breaks: true });

    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(a).toBe(a2);
    expect(a).not.toBe(b);
  });

  it("hashes the canonical four-member tuple, not the record's key order", () => {
    const canonical = { html: true, linkify: true, breaks: false, tocListType: "ol" as const };
    const reordered = { tocListType: "ol" as const, breaks: false, linkify: true, html: true };

    expect(optionsHash(canonical)).toBe(optionsHash(reordered));
    expect(Object.keys(defaultRenderOptions).toSorted()).toEqual([
      "breaks",
      "html",
      "linkify",
      "tocListType",
    ]);
  });

  it("changes when html or linkify changes", () => {
    const hashes = [
      optionsHash(defaultRenderOptions),
      optionsHash({ ...defaultRenderOptions, html: false }),
      optionsHash({ ...defaultRenderOptions, linkify: false }),
    ];

    expect(new Set(hashes).size).toBe(3);
  });

  it("defaults the TOC list type to ol", () => {
    expect(defaultRenderOptions.tocListType).toBe("ol");
  });

  it("changes when the list type changes", () => {
    const ol = optionsHash(defaultRenderOptions);
    const ul = optionsHash({ ...defaultRenderOptions, tocListType: "ul" });

    expect(ol).not.toBe(ul);
  });

  it("rejects a non-boolean html", () => {
    const input = { ...defaultRenderOptions, html: "no" };

    expect(() => Schema.decodeUnknownSync(RenderOptionsSchema)(input)).toThrow();
    expect(defaultRenderOptions.html).toBe(true);
  });

  it("rejects an unknown list type", () => {
    const input = { ...defaultRenderOptions, tocListType: "table" };

    expect(() => Schema.decodeUnknownSync(RenderOptionsSchema)(input)).toThrow();
  });
});
