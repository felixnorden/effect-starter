import { Schema } from "effect";
import { createHash } from "node:crypto";

/**
 * The render options: every markdown-it option that changes the output, plus the
 * TOC list type and the two asset policies. No configuration layer reads them.
 */
export type TocListType = "ol" | "ul";

/** markdown-it indexes its `quotes` value by UTF-16 unit; `all` is its alias. */
const QUOTES_ALL = ["\u201C", "\u201D", "\u2018", "\u2019"] as const;

const QuotesValue = Schema.String.check(
  Schema.makeFilter((value: string) => value === "all" || value.length === 4),
);

export const RenderOptionsSchema = Schema.Struct({
  html: Schema.Boolean,
  linkify: Schema.Boolean,
  breaks: Schema.Boolean,
  typographer: Schema.Boolean,
  quotes: QuotesValue,
  langPrefix: Schema.String,
  xhtmlOut: Schema.Boolean,
  tocListType: Schema.Literals(["ol", "ul"]),
  imageRoot: Schema.NullOr(Schema.String),
  allowRemote: Schema.Boolean,
});

export type RenderOptions = Schema.Schema.Type<typeof RenderOptionsSchema>;

export const defaultRenderOptions: RenderOptions = {
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
};

/**
 * The one place `all` becomes characters; nothing else interprets `quotes`.
 * `split("")` splits by UTF-16 unit, which is how markdown-it indexes the value.
 */
export const quoteCharacters = (quotes: string): string[] =>
  quotes === "all" ? [...QUOTES_ALL] : quotes.split("");

/**
 * The salt every block hash carries. Hash the options in field order, never
 * `JSON.stringify`, whose key order depends on how the record was built.
 * Nine members: `xhtmlOut` is decoded, validated, and provably inert.
 */
export const optionsHash = (options: RenderOptions): string =>
  createHash("sha256")
    .update(
      [
        options.html,
        options.linkify,
        options.breaks,
        options.typographer,
        options.quotes,
        options.langPrefix,
        options.tocListType,
        String(options.imageRoot),
        options.allowRemote,
      ].join("\u0000"),
    )
    .digest("hex")
    .slice(0, 16);
