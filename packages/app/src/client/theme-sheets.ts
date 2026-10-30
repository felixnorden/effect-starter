import type { Display, ThemeSlot } from "./display.ts";
import { sheetUrl } from "./display.ts";

const SLOTS: readonly ThemeSlot[] = ["light", "dark"];
const SLOT_ATTRIBUTE = "data-mdv-theme-sheet";

/**
 * The slice of a document this module touches. A fake satisfies it in tests.
 * Kept narrow so the head stays the only thing under test.
 */
export type HeadDocument = {
  readonly head: { append(element: Element): void };
  createElement(tagName: "link"): Element;
  querySelector(selector: string): Element | null;
};

const linkFor = (doc: HeadDocument, slot: ThemeSlot): Element => {
  const selector = `link[${SLOT_ATTRIBUTE}="${slot}"]`;
  const existing = doc.querySelector(selector);
  if (existing !== null) return existing;

  const link = doc.createElement("link");
  link.setAttribute("rel", "stylesheet");
  link.setAttribute(SLOT_ATTRIBUTE, slot);
  doc.head.append(link);
  return link;
};

/**
 * One stylesheet link per mode, updated in place.
 *
 * A hoisted `<link precedence>` keeps every href React has rendered, so a
 * second choice leaves the earlier sheet in the cascade and the visible theme
 * stops following the select. These two links therefore live in the head and
 * never change identity: only their href moves.
 */
export const syncThemeSheets = (doc: HeadDocument, display: Display): void => {
  for (const slot of SLOTS) {
    const href = sheetUrl(display[slot].id);
    const link = linkFor(doc, slot);
    if (link.getAttribute("href") !== href) link.setAttribute("href", href);
  }
};
