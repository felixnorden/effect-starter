import type { SheetLink, SheetSlot } from "./session.ts";

const SLOT_ATTRIBUTE = "data-slot";
const SLOT_SELECTOR = `link[${SLOT_ATTRIBUTE}]`;

/**
 * The slice of a document this module touches. A fake satisfies it in tests.
 * Kept narrow so the head stays the only thing under test.
 */
export type HeadDocument = {
  readonly head: { append(element: Element): void };
  createElement(tagName: "link"): Element;
  querySelector(selector: string): Element | null;
  querySelectorAll(selector: string): ArrayLike<Element>;
};

const selectorFor = (slot: SheetSlot): string => `link[${SLOT_ATTRIBUTE}="${slot}"]`;

const slotOf = (element: Element): string | null => element.getAttribute(SLOT_ATTRIBUTE);

/** Every slot link currently in the head, in document order. */
const liveLinks = (doc: HeadDocument): readonly Element[] =>
  Array.from(doc.querySelectorAll(SLOT_SELECTOR));

const linkFor = (doc: HeadDocument, slot: SheetSlot): Element => {
  const existing = doc.querySelector(selectorFor(slot));
  if (existing !== null) return existing;

  const link = doc.createElement("link");
  link.setAttribute("rel", "stylesheet");
  link.setAttribute(SLOT_ATTRIBUTE, slot);
  doc.head.append(link);
  return link;
};

/**
 * The cascade reads document order, so the head must hold the slots in the
 * order the caller named them. Appending an attached link moves it, so one pass
 * in the wanted order is enough, and an already-correct head is left alone.
 */
const arrange = (doc: HeadDocument, links: readonly SheetLink[]): void => {
  const wanted = links.map((entry) => entry.slot);
  const current = liveLinks(doc).map(slotOf);
  if (wanted.join() === current.join()) return;

  for (const slot of wanted) {
    const link = doc.querySelector(selectorFor(slot));
    if (link !== null) doc.head.append(link);
  }
};

/**
 * One stylesheet link per slot, updated in place.
 *
 * A hoisted `<link precedence>` keeps every href React has rendered, so a
 * second choice leaves the earlier sheet in the cascade and the visible theme
 * stops following the select. These links therefore live in the head and never
 * change identity: only their href moves. A slot the caller stops naming loses
 * its link.
 */
export const syncThemeSheets = (doc: HeadDocument, links: readonly SheetLink[]): void => {
  const wanted = new Set<string>(links.map((entry) => entry.slot));

  for (const element of liveLinks(doc)) {
    const slot = slotOf(element);
    if (slot !== null && !wanted.has(slot)) element.remove();
  }

  for (const entry of links) {
    const link = linkFor(doc, entry.slot);
    if (link.getAttribute("href") !== entry.href) link.setAttribute("href", entry.href);
  }

  arrange(doc, links);
};
