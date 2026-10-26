import { Schema } from "effect";
import { createHash } from "node:crypto";

/**
 * The render options. `typographer` stays a fixed constant, so the record has
 * exactly the fields that change the output.
 */
export type TocListType = "ol" | "ul";

export const RenderOptionsSchema = Schema.Struct({
  html: Schema.Boolean,
  linkify: Schema.Boolean,
  breaks: Schema.Boolean,
  tocListType: Schema.Literals(["ol", "ul"]),
});

export type RenderOptions = Schema.Schema.Type<typeof RenderOptionsSchema>;

export const defaultRenderOptions: RenderOptions = {
  html: true,
  linkify: true,
  breaks: false,
  tocListType: "ol",
};

/**
 * The salt every block hash carries. Hash the options in field order, never
 * `JSON.stringify`, whose key order depends on how the record was built.
 */
export const optionsHash = (options: RenderOptions): string =>
  createHash("sha256")
    .update([options.html, options.linkify, options.breaks, options.tocListType].join("\u0000"))
    .digest("hex")
    .slice(0, 16);
