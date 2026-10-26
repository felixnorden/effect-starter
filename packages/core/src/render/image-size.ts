import type { StateInline } from "markdown-it";

export type ImageSize = { readonly width: number | null; readonly height: number | null };

const SIZE_SPEC = /^=\s*(-?\d+)?\s*(?:x\s*(-?\d+)?)?$/u;

const positiveOrNull = (value: number | null): number | null =>
  value !== null && value > 0 ? value : null;

/** `=W`, `=WxH`, `=Wx`, `=xH`; a bare number is a width; null for anything else. */
export const parseImageSize = (spec: string): ImageSize | null => {
  const match = SIZE_SPEC.exec(spec.trim());
  if (match === null) return null;

  const width = positiveOrNull(match[1] === undefined ? null : Number(match[1]));
  const height = positiveOrNull(match[2] === undefined ? null : Number(match[2]));

  return width === null && height === null ? null : { width, height };
};

/**
 * An inline image rule that reads `![label](dest [title] =spec)`. markdown-it
 * cannot parse the unquoted spec at all, so the rule runs before `image` and
 * falls through whenever the source carries no `=` spec.
 */
export const imageSizeRule = (state: StateInline, silent: boolean): boolean => {
  const max = state.posMax;
  if (state.src.charCodeAt(state.pos) !== 0x21 /* ! */) return false;
  if (state.src.charCodeAt(state.pos + 1) !== 0x5b /* [ */) return false;

  const labelStart = state.pos + 2;
  const labelEnd = state.md.helpers.parseLinkLabel(state, state.pos + 1, false);
  if (labelEnd < 0) return false;

  let pos = labelEnd + 1;
  if (pos >= max || state.src.charCodeAt(pos) !== 0x28 /* ( */) return false;
  pos += 1;

  const isSpace = state.md.utils.isSpace;
  while (pos < max && isSpace(state.src.charCodeAt(pos))) pos += 1;
  if (pos >= max) return false;

  const destination = state.md.helpers.parseLinkDestination(state.src, pos, state.posMax);
  if (!destination.ok) return false;
  const href = state.md.normalizeLink(destination.str);
  if (!state.md.validateLink(href)) return false;
  pos = destination.pos;

  let title = "";
  const afterDestination = pos;
  while (pos < max && isSpace(state.src.charCodeAt(pos))) pos += 1;
  if (pos < max && afterDestination !== pos) {
    const parsed = state.md.helpers.parseLinkTitle(state.src, pos, state.posMax);
    if (parsed.ok) {
      title = parsed.str;
      pos = parsed.pos;
    }
    while (pos < max && isSpace(state.src.charCodeAt(pos))) pos += 1;
  }

  const specStart = pos;
  while (pos < max && state.src.charCodeAt(pos) !== 0x29 /* ) */) pos += 1;
  if (pos >= max) return false;

  const spec = state.src.slice(specStart, pos);
  if (!spec.startsWith("=")) return false;
  const size = parseImageSize(spec);
  pos += 1;

  if (!silent) {
    const content = state.src.slice(labelStart, labelEnd);
    const children: StateInline["tokens"] = [];
    state.md.inline.parse(content, state.md, state.env, children);

    const token = state.push("image", "img", 0);
    const attrs: [string, string][] = [
      ["src", href],
      ["alt", ""],
    ];
    token.attrs = attrs;
    token.children = children;
    token.content = content;
    if (size?.width !== null && size !== null) attrs.push(["width", String(size.width)]);
    if (size?.height !== null && size !== null) attrs.push(["height", String(size.height)]);
    if (title !== "") attrs.push(["title", title]);
  }

  state.pos = pos;
  state.posMax = max;
  return true;
};
