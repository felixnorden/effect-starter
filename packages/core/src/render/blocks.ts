import { footnote } from "@mdit/plugin-footnote";
import type { Element, ElementContent, Properties, Text } from "hast";
import deflist from "markdown-it-deflist";
import { full as emoji } from "markdown-it-emoji";
import MarkdownIt, { type MarkdownIt as MarkdownItInstance } from "markdown-it";

import type { BlockKind, LineRange } from "../model.ts";
import {
  FOOTNOTE_ID_PATTERN,
  footnoteSectionRange,
  isFootnoteInlineToken,
  isFootnoteSectionToken,
  isTransparentContainer,
} from "./footnotes.ts";
import { imageSizeRule } from "./image-size.ts";
import { MATH_INLINE_TOKEN, mathPlugin, renderMath } from "./math.ts";
import { quoteCharacters, type RenderOptions } from "./options.ts";
import { sanitizeFragment } from "./raw-html.ts";
import { buildToc, headingText, isTocMarker, type HeadingEntry } from "./toc.ts";

/** The slice of markdown-it's `Token` this package reads. */
export type Token = {
  readonly type: string;
  readonly tag: string;
  readonly nesting: number;
  readonly level: number;
  readonly map: readonly [number, number] | null;
  readonly hidden: boolean;
  readonly content: string;
  readonly info: string;
  readonly markup: string;
  readonly attrs: readonly (readonly [string, string])[] | null;
  readonly children: readonly Token[] | null;
  readonly meta: { readonly id?: number; readonly subId?: number; readonly label?: string } | null;
};

/** The slice of markdown-it this package needs, so tests can pass a stub. */
export type MarkdownParser = {
  readonly parse: (source: string, env: Record<string, unknown>) => readonly Token[];
  readonly renderInline?: (tokens: readonly Token[], env: Record<string, unknown>) => string;
};

export type HastBlockKind = Exclude<BlockKind, "frontMatter" | "code" | "html">;

/** A top-level block before sanitizing, highlighting, and hashing. */
export type BlockSkeleton =
  | {
      readonly kind: "code";
      readonly range: LineRange;
      readonly lang: string | null;
      readonly code: string;
    }
  | { readonly kind: "html"; readonly range: LineRange; readonly fragment: string }
  | {
      readonly kind: HastBlockKind;
      readonly range: LineRange;
      readonly hast: ElementContent[];
    };

/** Every field of the record reaches the one parser construction. */
const parserOptions = (options: RenderOptions) => ({
  html: options.html,
  linkify: options.linkify,
  breaks: options.breaks,
  typographer: options.typographer,
  quotes: quoteCharacters(options.quotes),
  xhtmlOut: options.xhtmlOut,
  langPrefix: options.langPrefix,
});

export const createMarkdownIt = (options: RenderOptions): MarkdownParser => {
  const markdownIt = new MarkdownIt(parserOptions(options));
  installPlugins(markdownIt);

  return {
    parse: (source, env) => markdownIt.parse(source, env) as unknown as readonly Token[],
    renderInline: (tokens, env) =>
      markdownIt.renderer.renderInline(tokens as never, markdownIt.options, env),
  };
};

/** `@types/markdown-it-emoji` types its receiver as the constructor, not the instance. */
const emojiPlugin = emoji as unknown as (
  markdownIt: MarkdownItInstance,
  options?: { readonly shortcuts?: Record<string, string | readonly string[]> },
) => void;

/** Every syntax this package renders attaches here, in one visible order. */
const installPlugins = (markdownIt: MarkdownItInstance): void => {
  mathPlugin(markdownIt);
  markdownIt.inline.ruler.before("image", "image_size", imageSizeRule);
  markdownIt.use(footnote);
  markdownIt.use(deflist);
  markdownIt.use(emojiPlugin, { shortcuts: {} });
};

/**
 * Turn the parsed body into one skeleton per top-level block. Only level-0
 * tokens count, and an open token pairs with its close, so a nested list is one
 * block rather than one per item.
 */
export const collectBlocks = (
  markdownIt: MarkdownParser,
  body: string,
  options: RenderOptions,
): BlockSkeleton[] => {
  const tokens = markdownIt.parse(body, {});
  const tasks = findTaskItems(tokens);
  const headings = indexHeadings(tokens);
  const blocks: BlockSkeleton[] = [];
  let lastLine = 0;
  let index = 0;
  let tocCount = 0;

  while (index < tokens.length) {
    const token = tokens[index];
    if (token === undefined || token.hidden || token.level !== 0 || token.nesting === -1) {
      index += 1;
      continue;
    }

    const end = token.nesting === 1 ? findClose(tokens, index) : index;
    const kind = kindOf(token.type);
    const range =
      kind === "footnote"
        ? (footnoteSectionRange(tokens.slice(index, end + 1)) ?? rangeOf(token, lastLine))
        : rangeOf(token, lastLine);
    lastLine = range.endLine;

    if (kind === "code") {
      blocks.push({
        kind: "code",
        range,
        lang: token.type === "code_block" ? null : readLang(token.info),
        code: token.content,
      });
    } else if (kind === "html") {
      blocks.push({ kind: "html", range, fragment: token.content });
    } else if (kind === "paragraph" && tocMarkerOf(tokens, index, end) !== null) {
      const nav = buildToc(headings.entries, options.tocListType, tocCount + 1);
      if (nav === null) {
        blocks.push({
          kind,
          range,
          hast: buildTree(
            markdownIt,
            tokens.slice(index, end + 1),
            tasks,
            headings.ids,
            options.langPrefix,
          ),
        });
      } else {
        tocCount += 1;
        blocks.push({ kind: "toc", range, hast: [nav] });
      }
    } else {
      blocks.push({
        kind,
        range,
        hast: buildTree(
          markdownIt,
          tokens.slice(index, end + 1),
          tasks,
          headings.ids,
          options.langPrefix,
        ),
      });
    }

    index = end + 1;
  }

  return blocks;
};

type HeadingIndex = {
  readonly ids: Map<Token, string>;
  readonly entries: HeadingEntry[];
};

/** One slugger owns every heading id; the map is keyed by the heading's identity. */
const indexHeadings = (tokens: readonly Token[]): HeadingIndex => {
  const hasFootnotes = tokens.some(
    (token) =>
      token.type.startsWith("footnote") ||
      (token.children ?? []).some((child) => child.type.startsWith("footnote")),
  );
  const slug = createSlugger(
    hasFootnotes ? (candidate) => FOOTNOTE_ID_PATTERN.test(candidate) : undefined,
  );
  const ids = new Map<Token, string>();
  const entries: HeadingEntry[] = [];

  for (const [index, token] of tokens.entries()) {
    if (token.type !== "heading_open") continue;
    const next = tokens[index + 1];
    const inline = next?.type === "inline" ? next : undefined;
    const id = slug(inline?.content ?? "");

    ids.set(token, id);
    entries.push({
      sourceLevel: Number(token.tag.slice(1)),
      id,
      text: headingText(inline?.children ?? []) || id,
      topLevel: token.level === 0,
    });
  }

  return { ids, entries };
};

/** Emphasis boundaries only: a marker wrapped in `**` or linked text stays literal. */
const MARKER_WRAPPER_TYPES = new Set(["text", "em_open", "em_close"]);

/** The inline token when the level-0 paragraph is exactly one TOC marker. */
const tocMarkerOf = (tokens: readonly Token[], start: number, end: number): Token | null => {
  if (tokens[start]?.type !== "paragraph_open") return null;
  const inline = tokens.slice(start, end + 1).find((token) => token.type === "inline");
  if (inline === undefined || !isTocMarker(inline.content)) return null;
  const children = inline.children ?? [];
  return children.every((child) => MARKER_WRAPPER_TYPES.has(child.type)) ? inline : null;
};

type TaskInfo = {
  readonly inline: Token;
  readonly checked: boolean;
  readonly prefixLength: number;
};

const TASK_MARKER = /^\[([ xX])\]\s+/;

const findTaskItems = (tokens: readonly Token[]): Map<Token, TaskInfo> => {
  const tasks = new Map<Token, TaskInfo>();

  for (const [index, token] of tokens.entries()) {
    if (token.type !== "list_item_open") continue;
    const end = findClose(tokens, index);
    const inline = tokens.slice(index + 1, end).find((entry) => entry.type === "inline");
    if (inline === undefined) continue;
    const match = TASK_MARKER.exec(inline.content);
    if (match === null) continue;

    tasks.set(token, {
      inline,
      checked: (match[1] ?? " ").toLowerCase() === "x",
      prefixLength: match[0].length,
    });
  }

  return tasks;
};

const findClose = (tokens: readonly Token[], start: number): number => {
  let depth = 0;
  for (let index = start; index < tokens.length; index += 1) {
    depth += tokens[index]?.nesting ?? 0;
    if (depth === 0) return index;
  }
  return tokens.length - 1;
};

const rangeOf = (token: Token, lastLine: number): LineRange =>
  token.map === null
    ? { startLine: lastLine + 1, endLine: lastLine + 1 }
    : { startLine: token.map[0] + 1, endLine: token.map[1] };

const kindOf = (type: string): "code" | "html" | HastBlockKind => {
  switch (type) {
    case "heading_open":
      return "heading";
    case "paragraph_open":
      return "paragraph";
    case "bullet_list_open":
    case "ordered_list_open":
      return "list";
    case "blockquote_open":
      return "blockquote";
    case "table_open":
      return "table";
    case "fence":
    case "code_block":
      return "code";
    case "html_block":
      return "html";
    case "hr":
      return "thematicBreak";
    case "math_block":
      return "math";
    case "footnote_block_open":
      return "footnote";
    case "dl_open":
      return "list";
    default:
      return "other";
  }
};

const readLang = (info: string): string | null => {
  const lang = info.trim().split(/\s+/)[0];
  return lang === undefined || lang === "" ? null : lang;
};

const textNode = (value: string): Text => ({ type: "text", value });

/** Private-use markers that carry one generated leaf through an authored render. */
const SENTINEL_START = "\uE000";
const SENTINEL_END = "\uE001";
const SENTINEL_PATTERN = /\uE000(\d+)\uE001/gu;

/** An inline token that renders through the generated allowlist, not the raw one. */
const isGeneratedInline = (type: string): boolean =>
  type === MATH_INLINE_TOKEN || isFootnoteInlineToken(type);

/** The sentinel never survives: authored text loses it before the run renders. */
const stripSentinels = (token: Token): Token => ({
  ...token,
  content: token.content.replaceAll(SENTINEL_START, "").replaceAll(SENTINEL_END, ""),
  children: token.children === null ? null : token.children.map(stripSentinels),
});

/** Split the sanitized text nodes at the sentinels and insert each leaf's nodes. */
const spliceGenerated = (
  nodes: ElementContent[],
  leaves: readonly (readonly ElementContent[])[],
): ElementContent[] => {
  const result: ElementContent[] = [];

  for (const node of nodes) {
    if (node.type === "text") {
      let lastIndex = 0;
      for (const match of node.value.matchAll(SENTINEL_PATTERN)) {
        if (match.index > lastIndex) {
          result.push(textNode(node.value.slice(lastIndex, match.index)));
        }
        for (const leaf of leaves[Number(match[1])] ?? []) result.push(leaf);
        lastIndex = match.index + match[0].length;
      }
      if (lastIndex < node.value.length) result.push(textNode(node.value.slice(lastIndex)));
      continue;
    }

    if (node.type === "element") {
      result.push({ ...node, children: spliceGenerated(node.children, leaves) });
      continue;
    }

    result.push(node);
  }

  return result;
};

/**
 * One authored run renders once. Each generated token becomes a sentinel before
 * the render, and its own HTML crosses the generated allowlist afterwards, so
 * nesting, links, and authored raw HTML keep markdown-it's pairing.
 */
const renderInlineWithGenerated = (
  markdownIt: MarkdownParser,
  children: readonly Token[],
): ElementContent[] => {
  const renderInline = markdownIt.renderInline;
  if (renderInline === undefined) return [];

  const leaves: (readonly ElementContent[])[] = [];
  const spliced: Token[] = [];

  for (const child of children) {
    if (!isGeneratedInline(child.type)) {
      spliced.push(stripSentinels(child));
      continue;
    }

    const index = leaves.length;
    leaves.push(sanitizeFragment(renderInline([child], {}), "generated"));
    spliced.push({
      ...child,
      type: "text",
      tag: "",
      nesting: 0,
      content: `${SENTINEL_START}${index}${SENTINEL_END}`,
      children: null,
      attrs: null,
      markup: "",
    });
  }

  return spliceGenerated(sanitizeFragment(renderInline(spliced, {})), leaves);
};

const elementNode = (
  tagName: string,
  properties: Properties,
  children: ElementContent[] = [],
): Element => ({ type: "element", tagName, properties, children });

const propsFromAttrs = (attrs: Token["attrs"]): Properties => {
  const properties: Properties = {};
  for (const [name, value] of attrs ?? []) {
    if (name === "class") properties.className = value.split(/\s+/);
    else if (name === "style") continue;
    else properties[name] = value;
  }
  return properties;
};

/** Source level → emitted level. Ids are minted before this and never change. */
const DEMOTED_HEADING_TAGS: Record<string, string> = {
  h1: "h2",
  h2: "h3",
  h3: "h4",
  h4: "h5",
  h5: "h6",
  h6: "h6",
};

const buildTree = (
  markdownIt: MarkdownParser,
  tokens: readonly Token[],
  tasks: Map<Token, TaskInfo>,
  headingIds: Map<Token, string>,
  langPrefix: string,
): ElementContent[] => {
  const root: ElementContent[] = [];
  const stack: Element[] = [];
  /** One entry per open token: true when its element was skipped, not mapped. */
  const skipped: boolean[] = [];

  const append = (node: ElementContent): void => {
    const parent = stack.at(-1);
    if (parent === undefined) root.push(node);
    else parent.children.push(node);
  };

  for (const [index, token] of tokens.entries()) {
    if (token.hidden) continue;

    // The wrapper is core HAST: the plugin's ids, classes, and empty tags never
    // reach the page.
    if (token.type === "footnote_block_open") {
      append(elementNode("hr", { className: ["footnotes-sep"] }));
      const section = elementNode("section", {
        className: ["footnotes"],
        dataFootnotes: "",
      });
      const list = elementNode("ol", { className: ["footnotes-list"] });
      section.children.push(list);
      append(section);
      stack.push(section, list);
      continue;
    }

    if (token.type === "footnote_block_close") {
      stack.pop();
      stack.pop();
      continue;
    }

    if (token.nesting === -1) {
      if (skipped.pop() === true) continue;
      stack.pop();
      continue;
    }

    if (token.nesting === 1) {
      // The item is mapped, not skipped, so it is exempt from the transparent rule.
      if (token.type === "footnote_open") {
        const item = elementNode("li", {
          id: `footnote${(token.meta?.id ?? 0) + 1}`,
          className: ["footnote-item"],
        });
        append(item);
        stack.push(item);
        skipped.push(false);
        continue;
      }

      const transparent = isTransparentContainer(token) && !isFootnoteSectionToken(token.type);
      skipped.push(transparent);
      if (transparent) continue;

      const tagName =
        token.type === "heading_open" ? (DEMOTED_HEADING_TAGS[token.tag] ?? token.tag) : token.tag;
      const element = elementNode(tagName, propsFromAttrs(token.attrs));
      append(element);
      stack.push(element);

      if (token.type === "heading_open") {
        const inline = tokens.slice(index + 1).find((entry) => entry.type === "inline");
        element.properties.id = headingIds.get(token) ?? slugify(inline?.content ?? "");
      }

      if (token.type === "list_item_open") {
        const task = tasks.get(token);
        if (task === undefined) continue;
        element.properties.className = ["task-list-item"];
        element.children.push(
          elementNode("input", {
            type: "checkbox",
            checked: task.checked,
            disabled: true,
            // The item's own text names its checkbox for assistive technology.
            ariaLabel: task.inline.content.slice(task.prefixLength).trim(),
          }),
        );
        const list = stack.findLast((entry) => entry.tagName === "ul" || entry.tagName === "ol");
        if (list !== undefined) list.properties.className = ["contains-task-list"];
      }

      continue;
    }

    if (token.type === "inline") {
      const task = [...tasks.values()].find((entry) => entry.inline === token);
      const children =
        task === undefined ? (token.children ?? []) : stripPrefix(token.children ?? [], task);
      const generated = children.some((child) => isGeneratedInline(child.type));

      if (markdownIt.renderInline === undefined || !generated) {
        const html =
          markdownIt.renderInline === undefined
            ? children.map((child) => child.content).join("")
            : markdownIt.renderInline(children, {});
        for (const node of sanitizeFragment(html)) append(node);
        continue;
      }

      for (const node of renderInlineWithGenerated(markdownIt, children)) append(node);
      continue;
    }

    if (token.type === "fence" || token.type === "code_block") {
      const lang = readLang(token.info);
      append(
        elementNode("pre", {}, [
          elementNode("code", lang === null ? {} : { className: [`${langPrefix}${lang}`] }, [
            textNode(token.content),
          ]),
        ]),
      );
      continue;
    }

    if (token.type === "html_block") {
      for (const node of sanitizeFragment(token.content)) append(node);
      continue;
    }

    if (token.type === "math_block") {
      for (const node of sanitizeFragment(renderMath(token.content, true), "generated")) {
        append(node);
      }
      continue;
    }

    // The backlink is a level-0 leaf, not an inline child of the item.
    if (token.type === "footnote_anchor") {
      const html = markdownIt.renderInline?.([token], {}) ?? "";
      for (const node of sanitizeFragment(html, "generated")) append(node);
      continue;
    }

    if (token.type === "hr") {
      append(elementNode("hr", {}));
      continue;
    }

    if (token.tag !== "") append(elementNode(token.tag, propsFromAttrs(token.attrs)));
  }

  return root;
};

const stripPrefix = (children: readonly Token[], task: TaskInfo): readonly Token[] => {
  const [first, ...rest] = children;
  if (first === undefined || first.type !== "text") return children;
  return [{ ...first, content: first.content.slice(task.prefixLength) }, ...rest];
};

const slugify = (value: string): string => {
  const base = value
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s+/gu, "-")
    .replace(/-+/gu, "-")
    .replace(/^-+|-+$/gu, "");
  return base === "" ? "section" : base;
};

/** GitHub-style slugs: a document-wide set, so duplicates get `-1`, `-2`, … */
export const createSlugger = (
  isReserved: (candidate: string) => boolean = () => false,
): ((value: string) => string) => {
  const used = new Set<string>();
  return (value) => {
    const base = slugify(value);
    let candidate = base;
    for (let suffix = 1; used.has(candidate) || isReserved(candidate); suffix += 1) {
      candidate = `${base}-${suffix}`;
    }
    used.add(candidate);
    return candidate;
  };
};
