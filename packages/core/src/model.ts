// @effect-diagnostics schemaNumber:off
import { Schema } from "effect";

/** A block id is minted by the session and never derived from content. */
export const BlockIdSchema = Schema.String.pipe(Schema.brand("BlockId"));
export type BlockId = Schema.Schema.Type<typeof BlockIdSchema>;

export const BlockKindSchema = Schema.Literals([
  "frontMatter",
  "heading",
  "paragraph",
  "list",
  "blockquote",
  "table",
  "code",
  "html",
  "thematicBreak",
  "other",
  "math",
  "toc",
  "footnote",
]);
export type BlockKind = Schema.Schema.Type<typeof BlockKindSchema>;

/** 1-based, inclusive. Ranges come from the parser's token maps. */
export const LineRangeSchema = Schema.Struct({
  startLine: Schema.Number,
  endLine: Schema.Number,
});
export type LineRange = Schema.Schema.Type<typeof LineRangeSchema>;
