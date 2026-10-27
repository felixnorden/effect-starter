import { Result, Schema } from "effect";
import { describe, expect, it } from "vitest";

import { defaultRenderOptions, optionsHash, RenderOptionsSchema } from "./options.ts";

const decode = (input: unknown) => Schema.decodeUnknownResult(RenderOptionsSchema)(input);

describe("RenderOptionsSchema", () => {
  it("decodes a record with all ten fields and the shipped defaults", () => {
    const result = decode({
      html: true,
      linkify: true,
      breaks: false,
      typographer: false,
      quotes: "all",
      langPrefix: "language-",
      xhtmlOut: false,
      tocListType: "ol",
      imageRoot: null,
      allowRemote: true,
    });

    expect(Result.isSuccess(result)).toBe(true);
    expect(Object.keys(defaultRenderOptions).toSorted()).toEqual([
      "allowRemote",
      "breaks",
      "html",
      "imageRoot",
      "langPrefix",
      "linkify",
      "quotes",
      "tocListType",
      "typographer",
      "xhtmlOut",
    ]);
  });

  it("fails decoding for a quotes value that is neither all nor four UTF-16 units", () => {
    const values = ["xy", "«»„", "a😀bc"];

    for (const quotes of values) {
      const result = decode({ ...defaultRenderOptions, quotes });
      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(String(result.failure)).toContain("quotes");
      }
    }
  });

  it("accepts all and a four-unit value and keeps the value it was given", () => {
    const all = decode({ ...defaultRenderOptions, quotes: "all" });
    const custom = decode({ ...defaultRenderOptions, quotes: "«»„‚" });

    expect(Result.isSuccess(all)).toBe(true);
    expect(Result.isSuccess(custom)).toBe(true);
    if (Result.isSuccess(custom)) expect(custom.success.quotes).toBe("«»„‚");
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

describe("optionsHash", () => {
  it("is stable for the same record and changes when one option changes", () => {
    const a = optionsHash(defaultRenderOptions);
    const a2 = optionsHash({ ...defaultRenderOptions });
    const b = optionsHash({ ...defaultRenderOptions, breaks: true });

    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(a).toBe(a2);
    expect(a).not.toBe(b);
  });

  it("hashes the canonical nine-member tuple, not the record's key order", () => {
    const canonical = { ...defaultRenderOptions };
    const reordered = {
      allowRemote: defaultRenderOptions.allowRemote,
      imageRoot: defaultRenderOptions.imageRoot,
      tocListType: defaultRenderOptions.tocListType,
      xhtmlOut: defaultRenderOptions.xhtmlOut,
      langPrefix: defaultRenderOptions.langPrefix,
      quotes: defaultRenderOptions.quotes,
      typographer: defaultRenderOptions.typographer,
      breaks: defaultRenderOptions.breaks,
      linkify: defaultRenderOptions.linkify,
      html: defaultRenderOptions.html,
    };

    expect(optionsHash(reordered)).toBe(optionsHash(canonical));
  });

  it("changes the salt for each of the nine members", () => {
    const variations = [
      { html: false },
      { linkify: false },
      { breaks: true },
      { typographer: true },
      { quotes: "«»„‚" },
      { langPrefix: "lang-" },
      { tocListType: "ul" as const },
      { imageRoot: "/tmp/assets" },
      { allowRemote: false },
    ].map((variation) => optionsHash({ ...defaultRenderOptions, ...variation }));
    const distinct = new Set([optionsHash(defaultRenderOptions), ...variations]);

    expect(distinct.size).toBe(10);
  });

  it("keeps xhtmlOut out of the salt", () => {
    const off = optionsHash(defaultRenderOptions);
    const on = optionsHash({ ...defaultRenderOptions, xhtmlOut: true });

    expect(on).toBe(off);
  });

  it("distinguishes an unset image root from an empty one", () => {
    const unset = optionsHash({ ...defaultRenderOptions, imageRoot: null });
    const empty = optionsHash({ ...defaultRenderOptions, imageRoot: "" });

    expect(unset).not.toBe(empty);
  });

  it("defaults the TOC list type to ol", () => {
    expect(defaultRenderOptions.tocListType).toBe("ol");
  });
});
