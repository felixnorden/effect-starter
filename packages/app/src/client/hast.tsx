import { createElement, type ReactNode } from "react";

export type HastText = {
  readonly type: "text";
  readonly value: string;
};

export type HastElement = {
  readonly type: "element";
  readonly tagName: string;
  readonly properties?: Record<string, unknown>;
  readonly children?: readonly HastNode[];
};

export type HastNode = HastText | HastElement;
export type HastChildren = readonly HastNode[];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isNode = (value: unknown): value is HastNode => {
  if (!isRecord(value)) return false;
  if (value.type === "text") return typeof value.value === "string";
  if (value.type !== "element") return false;
  if (typeof value.tagName !== "string") return false;
  if (value.children === undefined) return true;
  return Array.isArray(value.children) && value.children.every(isNode);
};

/** The one runtime guard for the `unknown` `hast` field. */
export const readTree = (value: unknown): HastChildren | null =>
  Array.isArray(value) && value.every(isNode) ? (value as HastChildren) : null;

/** Properties the page maps. Everything else, including `on*`, is dropped. */
const ALLOWED_PROPERTIES = new Set([
  "id",
  "href",
  "src",
  "alt",
  "title",
  "width",
  "height",
  "type",
  "checked",
  "disabled",
  "htmlFor",
  "start",
  "colSpan",
  "rowSpan",
  "align",
  "open",
  "tabIndex",
  "role",
  "xmlns",
  "viewBox",
  "preserveAspectRatio",
  "d",
]);

const BOOLEAN_PROPERTIES = new Set(["checked", "disabled"]);

/** dataFootnotes → data-footnotes, ariaHidden → aria-hidden, ariaLabel → aria-label. */
const toHyphenated = (key: string): string =>
  key.replace(/[A-Z]/gu, (letter) => `-${letter.toLowerCase()}`);

const parseStyle = (value: string): Record<string, string> => {
  const style: Record<string, string> = {};
  for (const declaration of value.split(";")) {
    const separator = declaration.indexOf(":");
    if (separator === -1) continue;
    const name = declaration.slice(0, separator).trim();
    const raw = declaration.slice(separator + 1).trim();
    if (name === "" || raw === "") continue;
    const property = name.startsWith("--")
      ? name
      : name.replace(/-([a-z])/gu, (_, letter: string) => letter.toUpperCase());
    style[property] = raw;
  }
  return style;
};

/** HAST properties to React props: style strings become objects, class arrays join. */
export const toReactProperties = (
  properties: Record<string, unknown> = {},
): Record<string, unknown> => {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(properties)) {
    if (key.startsWith("on")) continue;

    // The sanitizer emits camelCase for both families, so both are rewritten.
    if (/^(?:aria|data)[A-Z]/u.test(key)) {
      result[toHyphenated(key)] = value;
      continue;
    }

    if (key === "class" || key === "className") {
      const joined = Array.isArray(value) ? value.join(" ") : value;
      if (typeof joined === "string" && joined !== "") result.className = joined;
      continue;
    }

    if (key === "style") {
      if (typeof value === "string") result.style = parseStyle(value);
      else if (isRecord(value)) result.style = value;
      continue;
    }

    if (key.startsWith("data-") || key.startsWith("aria-")) {
      result[key] = value;
      continue;
    }

    if (key === "htmlFor") {
      result.htmlFor = value;
      continue;
    }

    if (!ALLOWED_PROPERTIES.has(key)) continue;

    if (BOOLEAN_PROPERTIES.has(key)) {
      if (value !== undefined) result[key] = Boolean(value);
      continue;
    }

    result[key] = value;
  }

  return result;
};

const VOID_ELEMENTS = new Set(["img", "br", "hr", "input", "source", "meta", "link"]);

const PASS_THROUGH_SCHEMES = ["http:", "https:", "mailto:"];

/** Core owns the reference shape; the page owns the route that serves it. */
const IMAGE_ROOT_PREFIX = "/image-root/";

/**
 * The page's one reference rule, for `img src` and `a href`. A relative
 * reference that normalizes inside the source directory is rewritten onto the
 * local route; an escaping, absolute, or drive-path reference is dropped.
 */
export const mapReference = (attribute: "src" | "href", value: string): string | null => {
  if (value.startsWith("#")) return value;
  if (value.startsWith("//")) return value;
  if (PASS_THROUGH_SCHEMES.some((scheme) => value.toLowerCase().startsWith(scheme))) {
    return value;
  }
  if (attribute === "src" && /^data:image\//iu.test(value)) return value;
  if (value.startsWith(IMAGE_ROOT_PREFIX)) return mapRootReference(value);
  // Any other scheme (`javascript:`, `data:text/html`, `vbscript:`) never
  // becomes a route.
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/u.test(value)) return null;

  const hashIndex = value.indexOf("#");
  const beforeHash = hashIndex === -1 ? value : value.slice(0, hashIndex);
  const fragment = hashIndex === -1 ? "" : value.slice(hashIndex);
  const queryIndex = beforeHash.indexOf("?");
  const rawPath = queryIndex === -1 ? beforeHash : beforeHash.slice(0, queryIndex);
  const query = queryIndex === -1 ? "" : beforeHash.slice(queryIndex);

  if (rawPath === "") return null;
  if (rawPath.startsWith("/")) return null;
  if (/^[a-zA-Z]:[\\/]/u.test(rawPath)) return null;

  const normalized: string[] = [];
  for (const segment of rawPath.replaceAll("\\", "/").split("/")) {
    if (segment === "" || segment === ".") continue;

    let decoded: string;
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      return null;
    }

    if (decoded.includes("/") || decoded.includes("\\")) return null;
    if (decoded === ".") continue;
    if (decoded === "..") {
      if (normalized.length === 0) return null;
      normalized.pop();
      continue;
    }
    normalized.push(decoded);
  }

  if (normalized.length === 0) return null;
  return `/local/${normalized.join("/")}${query}${fragment}`;
};

/** The same segment rules as a relative source, applied inside the image root. */
const mapRootReference = (value: string): string | null => {
  const hashIndex = value.indexOf("#");
  const beforeHash = hashIndex === -1 ? value : value.slice(0, hashIndex);
  const fragment = hashIndex === -1 ? "" : value.slice(hashIndex);
  const queryIndex = beforeHash.indexOf("?");
  const rawPath = queryIndex === -1 ? beforeHash : beforeHash.slice(0, queryIndex);
  const query = queryIndex === -1 ? "" : beforeHash.slice(queryIndex);
  if (rawPath.includes("\\") || /%(?:2f|5c)/iu.test(rawPath)) return null;

  const segments: string[] = [];
  for (const segment of rawPath.slice(IMAGE_ROOT_PREFIX.length).split("/")) {
    if (segment === "" || segment === ".") continue;

    let decoded: string;
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      return null;
    }

    if (decoded.includes("/") || decoded.includes("\\")) return null;
    if (decoded === ".") continue;
    if (decoded === "..") return null;
    segments.push(decoded);
  }

  if (segments.length === 0) return null;
  return `${IMAGE_ROOT_PREFIX}${segments.join("/")}${query}${fragment}`;
};

const withMappedReferences = (
  tagName: string,
  properties: Record<string, unknown>,
): Record<string, unknown> => {
  if (tagName !== "img" && tagName !== "a") return properties;

  const next = { ...properties };
  if (tagName === "img" && typeof next.src === "string") {
    const mapped = mapReference("src", next.src);
    if (mapped === null) delete next.src;
    else next.src = mapped;
  }
  if (tagName === "a" && typeof next.href === "string") {
    const mapped = mapReference("href", next.href);
    if (mapped === null) delete next.href;
    else next.href = mapped;
  }
  return next;
};

export type HastDecoration = (node: HastElement, element: ReactNode) => ReactNode;

export const HastNode = ({
  node,
  decorate,
}: {
  readonly node: HastNode;
  readonly decorate?: HastDecoration;
}): ReactNode => {
  if (node.type === "text") return node.value;

  const element = createElement(
    node.tagName,
    toReactProperties(withMappedReferences(node.tagName, node.properties ?? {})),
    VOID_ELEMENTS.has(node.tagName)
      ? undefined
      : (node.children ?? []).map((child, index) => (
          <HastNode key={index} node={child} decorate={decorate} />
        )),
  );
  return decorate === undefined ? element : decorate(node, element);
};
