import { defaultRenderOptions, type RenderOptions } from "../render/options.ts";

import type { NormalizedConfiguration } from "./validate.ts";

const valueOf = (config: NormalizedConfiguration, key: string): unknown =>
  config.values[key]?.value;

const markdownItKeys = [
  "html",
  "linkify",
  "breaks",
  "typographer",
  "quotes",
  "xhtmlOut",
  "langPrefix",
] as const;

/**
 * The one projection from the normalized configuration's render class to the
 * renderer's option record. A key the renderer has no field for is
 * accept-and-validate and projects nothing.
 */
export const projectRenderOptions = (config: NormalizedConfiguration): RenderOptions => {
  const options: { -readonly [K in keyof RenderOptions]: RenderOptions[K] } = {
    ...defaultRenderOptions,
  };
  const markdownIt = valueOf(config, "render.markdown_it");

  if (markdownIt !== null && typeof markdownIt === "object") {
    const source = markdownIt as Record<string, unknown>;
    for (const key of markdownItKeys) {
      const value = source[key];
      if (key === "quotes") {
        if (typeof value === "string" && (value === "all" || value.length === 4)) {
          options.quotes = value;
        }
      } else if (key === "langPrefix") {
        if (typeof value === "string") options.langPrefix = value;
      } else if (typeof value === "boolean") {
        options[key] = value;
      }
    }
  }

  const allowHtml = valueOf(config, "security.allow_html");
  if (typeof allowHtml === "boolean") options.html = allowHtml;

  const allowRemote = valueOf(config, "assets.allow_remote");
  if (typeof allowRemote === "boolean") options.allowRemote = allowRemote;

  const imageRoot = valueOf(config, "assets.image_root");
  options.imageRoot = typeof imageRoot === "string" ? imageRoot : null;

  return options;
};
