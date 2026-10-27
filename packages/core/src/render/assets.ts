import type { Element, ElementContent, Properties } from "hast";
import { posix } from "node:path";

import type { RenderOptions } from "./options.ts";

/** The one reference shape core owns; the app binds the root and serves it. */
export const IMAGE_ROOT_PREFIX = "/image-root/";

/** Property names are camelCase in HAST; the serializer hyphenates them. */
export const PLACEHOLDER_MARKER = "dataMdvPlaceholder";
export const AUTHORED_SOURCE_PROPERTY = "dataMdvSource";
export const RESOLVED_PATH_PROPERTY = "dataMdvResolved";

export type ImageOutcome = "data" | "relative" | "remote" | "rootReference" | "placeholder";

export type PlaceholderSize = {
  readonly width?: string;
  readonly height?: string;
};

export type ImageClassification = {
  readonly outcome: ImageOutcome;
  /** The rewritten source for a root reference; `null` for every other outcome. */
  readonly reference: string | null;
};

const DATA_IMAGE = /^data:image\//iu;
const SCHEME = /^[a-zA-Z][a-zA-Z0-9+.-]*:/u;

/** `120` becomes `120px`; `50%` and `auto` stay as written; absent adds nothing. */
const boxDeclarations = (size: PlaceholderSize): string =>
  Object.entries({ width: size.width, height: size.height })
    .filter(([, value]) => value !== undefined && value !== "")
    .map(([name, value]) => `${name}:${/^\d+$/u.test(value ?? "") ? `${value}px` : value}`)
    .join(";");

const normalise = (value: string): string => posix.normalize(value.replaceAll("\\", "/"));

/** The path inside the configured root, or `null` when the source is outside it. */
const insideRoot = (source: string, imageRoot: string | null): string | null => {
  if (imageRoot === null || imageRoot === "") return null;
  const root = normalise(imageRoot).replace(/\/+$/u, "");
  const candidate = normalise(source);
  if (!candidate.startsWith(`${root}/`)) return null;
  const inside = candidate.slice(root.length + 1);
  return inside === "" || inside === ".." || inside.startsWith("../") ? null : inside;
};

/** A root-named reference: root identity in the URL, path inside the root after it. */
export const referenceFor = (inside: string): string => `${IMAGE_ROOT_PREFIX}${inside}`;

/**
 * Lexical classification only: core has no file system, so membership is proved
 * by the app's resolver. A remote source needs the policy; every absolute source
 * that no root can contain becomes a placeholder.
 */
export const classifyImageSource = (
  source: string,
  options: Pick<RenderOptions, "imageRoot" | "allowRemote">,
): ImageClassification => {
  if (DATA_IMAGE.test(source)) return { outcome: "data", reference: null };
  if (source.startsWith("//") || SCHEME.test(source)) {
    return options.allowRemote
      ? { outcome: "remote", reference: null }
      : { outcome: "placeholder", reference: null };
  }
  if (source.startsWith("/")) {
    const inside = insideRoot(source, options.imageRoot);
    return inside === null
      ? { outcome: "placeholder", reference: null }
      : { outcome: "rootReference", reference: referenceFor(inside) };
  }
  return { outcome: "relative", reference: null };
};

/** The one placeholder shape; the page's swap builds the same description. */
export const placeholderFor = (
  authoredSource: string,
  resolvedPath: string,
  size: PlaceholderSize,
  alt: string,
): Element => {
  const box = boxDeclarations(size);
  return {
    type: "element",
    tagName: "span",
    properties: {
      [PLACEHOLDER_MARKER]: "",
      [AUTHORED_SOURCE_PROPERTY]: authoredSource,
      [RESOLVED_PATH_PROPERTY]: resolvedPath,
      role: "img",
      ...(alt === "" ? {} : { ariaLabel: alt }),
      ...(box === "" ? {} : { style: box }),
    },
    children: [{ type: "text", value: resolvedPath }],
  };
};

const sizeOf = (properties: Properties): PlaceholderSize => {
  const width = properties.width;
  const height = properties.height;
  return {
    ...(typeof width === "string" || typeof width === "number" ? { width: String(width) } : {}),
    ...(typeof height === "string" || typeof height === "number" ? { height: String(height) } : {}),
  };
};

const altOf = (properties: Properties): string =>
  typeof properties.alt === "string" ? properties.alt : "";

/** One image, stamped and classified; `null` drops an image the gate emptied. */
const resolveImage = (
  image: Element,
  options: Pick<RenderOptions, "imageRoot" | "allowRemote">,
): ElementContent | null => {
  const source = image.properties.src;
  if (source === undefined) return null;
  if (typeof source !== "string") throw new Error("image source is not a string");

  const classification = classifyImageSource(source, options);
  if (classification.outcome === "placeholder") {
    return placeholderFor(source, source, sizeOf(image.properties), altOf(image.properties));
  }

  return {
    ...image,
    properties: {
      ...image.properties,
      [AUTHORED_SOURCE_PROPERTY]: source,
      ...(classification.reference === null ? {} : { src: classification.reference }),
    },
  };
};

/**
 * The asset stage: one traversal over an already-sanitized block tree. It runs
 * after assembly and before `hashBlock`, so the hash witnesses the rewrite, and
 * it is the only code that writes an `img` attribute.
 */
export const resolveImageSources = (
  nodes: readonly ElementContent[],
  options: Pick<RenderOptions, "imageRoot" | "allowRemote">,
): ElementContent[] =>
  nodes.flatMap((node) => {
    if (node.type !== "element") return [node];
    if (node.tagName === "img") {
      const resolved = resolveImage(node, options);
      return resolved === null ? [] : [resolved];
    }
    return [{ ...node, children: resolveImageSources(node.children, options) }];
  });
