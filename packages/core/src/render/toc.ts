import type { Element, ElementContent } from "hast";

import type { Token } from "./blocks.ts";
import type { TocListType } from "./options.ts";

/** The four marker spellings, exactly as the source writes them. */
export const TOC_MARKERS = ["${toc}", "[[toc]]", "[toc]", "[[_toc_]]"] as const;

/** The deepest source heading the list carries. */
export const TOC_MAX_SOURCE_LEVEL = 3;

/** One heading as the index records it before assembly. */
export type HeadingEntry = {
  readonly sourceLevel: number;
  readonly id: string;
  readonly text: string;
  readonly topLevel: boolean;
};

export const isTocMarker = (text: string): boolean =>
  (TOC_MARKERS as readonly string[]).includes(text.trim());

/** Inline tokens whose content is readable heading text. */
const READABLE_INLINE_TYPES = new Set(["text", "code_inline", "math_inline", "emoji"]);

const BREAK_TYPES = new Set(["softbreak", "hardbreak"]);

/** Text, code, math, emoji, and image alt; breaks become a space; HTML and footnotes skip. */
export const headingText = (children: readonly Token[]): string => {
  const parts: string[] = [];

  for (const child of children) {
    if (READABLE_INLINE_TYPES.has(child.type)) {
      parts.push(child.content);
      continue;
    }
    if (child.type === "image") {
      parts.push(child.children === null ? child.content : headingText(child.children));
      continue;
    }
    if (BREAK_TYPES.has(child.type)) parts.push(" ");
  }

  return parts.join(" ").replace(/\s+/gu, " ").trim();
};

/** Nav 1 is `Table of contents`; nav N is `Table of contents N`. */
const navLabel = (ordinal: number): string =>
  ordinal <= 1 ? "Table of contents" : `Table of contents ${ordinal}`;

const textNode = (value: string): ElementContent => ({ type: "text", value });

const elementNode = (
  tagName: string,
  properties: Element["properties"] = {},
  children: ElementContent[] = [],
): Element => ({ type: "element", tagName, properties, children });

/**
 * One flat nav over the top-level source h1–h3 headings, in document order.
 * Duplicate ids are already suffixed by the one slugger, so they need no work.
 */
export const buildToc = (
  entries: readonly HeadingEntry[],
  listType: TocListType,
  ordinal = 1,
): Element | null => {
  const listed = entries.filter(
    (entry) => entry.topLevel && entry.sourceLevel <= TOC_MAX_SOURCE_LEVEL,
  );
  if (listed.length === 0) return null;

  const items = listed.map((entry) =>
    elementNode("li", {}, [elementNode("a", { href: `#${entry.id}` }, [textNode(entry.text)])]),
  );

  return elementNode("nav", { className: ["table-of-contents"], ariaLabel: navLabel(ordinal) }, [
    elementNode(listType, {}, items),
  ]);
};
