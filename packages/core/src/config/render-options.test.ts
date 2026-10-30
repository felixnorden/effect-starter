import { describe, expect, it } from "vitest";

import { defaultRenderOptions, optionsHash } from "../render/options.ts";

import { projectRenderOptions } from "./render-options.ts";
import { validateConfiguration, type NormalizedConfiguration } from "./validate.ts";

const configOf = (
  values: readonly { readonly key: string; readonly value: unknown; readonly source: string }[],
): NormalizedConfiguration => {
  const result = validateConfiguration(values);
  if (!result.ok) throw new Error(result.rejection.expected);
  return result.config;
};

describe("render option projection", () => {
  it("projects the render class onto the renderer's option record", () => {
    const options = projectRenderOptions(
      configOf([
        { key: "render.markdown_it", value: { breaks: true }, source: "setup:render.markdown_it" },
        { key: "assets.allow_remote", value: false, source: "setup:assets.allow_remote" },
      ]),
    );

    expect(options.breaks).toBe(true);
    expect(options.allowRemote).toBe(false);
    expect(options).toEqual({ ...defaultRenderOptions, breaks: true, allowRemote: false });
  });

  it("never projects a page-display key", () => {
    const options = projectRenderOptions(
      configOf([{ key: "preview.width", value: "1200px", source: "setup:preview.width" }]),
    );

    expect(options).toEqual(defaultRenderOptions);
  });

  it("an opaque render object and an allowlist project nothing", () => {
    const options = projectRenderOptions(
      configOf([
        { key: "render.toc", value: { listType: "ul" }, source: "setup:render.toc" },
        { key: "render.katex", value: { throwOnError: true }, source: "setup:render.katex" },
        { key: "assets.allowlist", value: ["/a"], source: "setup:assets.allowlist" },
      ]),
    );

    expect(options).toEqual(defaultRenderOptions);
  });

  it("a changed render value changes the options hash and an unchanged one does not", () => {
    const first = projectRenderOptions(
      configOf([
        { key: "render.markdown_it", value: { breaks: true }, source: "setup:render.markdown_it" },
      ]),
    );
    const second = projectRenderOptions(
      configOf([
        { key: "render.markdown_it", value: { breaks: false }, source: "setup:render.markdown_it" },
      ]),
    );
    const same = projectRenderOptions(
      configOf([
        { key: "render.markdown_it", value: { breaks: true }, source: "g:markdown_viewer_mkit" },
      ]),
    );

    expect(optionsHash(first)).not.toBe(optionsHash(second));
    expect(optionsHash(first)).toBe(optionsHash(same));
  });
});
