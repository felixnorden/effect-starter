import { parse } from "yaml";

import type { LineRange } from "../model.ts";

const DELIMITER = "---";

export type FrontMatter = {
  readonly title: string | null;
  readonly range: LineRange;
  /** The source with the block replaced by blank lines, so token maps stay aligned. */
  readonly body: string;
};

/**
 * Split a leading YAML front-matter block from the source. The body keeps the
 * source's line numbers because every token map downstream is 1-based on the
 * original file.
 */
export const readFrontMatter = (source: string): FrontMatter | null => {
  const lines = source.split("\n");
  if (lines[0]?.trim() !== DELIMITER) return null;

  const closeIndex = lines.findIndex((line, index) => index > 0 && line.trim() === DELIMITER);
  if (closeIndex === -1) return null;

  const range: LineRange = { startLine: 1, endLine: closeIndex + 1 };
  return {
    title: readTitle(lines.slice(1, closeIndex).join("\n")),
    range,
    body: "\n".repeat(range.endLine) + lines.slice(range.endLine).join("\n"),
  };
};

/** A malformed document or a non-string title reads as "no title", never a throw. */
const readTitle = (yaml: string): string | null => {
  try {
    const value: unknown = parse(yaml);
    if (value === null || typeof value !== "object") return null;
    const title: unknown = (value as Record<string, unknown>).title;
    return typeof title === "string" ? title : null;
  } catch {
    return null;
  }
};
