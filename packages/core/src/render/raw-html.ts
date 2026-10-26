import type { ElementContent, Root } from "hast";
import { fromHtml } from "hast-util-from-html";
import { defaultSchema, sanitize, type Schema } from "hast-util-sanitize";

/**
 * The shipped policy. `protocols.src` gains `data` so a `data:image/*` URL
 * survives, and the `img` attributes admit every source except `data:` values
 * that are not an image.
 */
export const rawHtmlSanitizeSchema: Schema = {
  ...defaultSchema,
  protocols: {
    ...defaultSchema.protocols,
    src: [...(defaultSchema.protocols?.src ?? []), "data"],
  },
  attributes: {
    ...defaultSchema.attributes,
    img: [
      ["src", /^data:image\//, /^(?!data:)/i],
      "ariaDescribedBy",
      "ariaLabel",
      "ariaLabelledBy",
      "longDesc",
      "alt",
      "title",
      "width",
      "height",
    ],
  },
};

/** Every MathML element name KaTeX can emit, in name order. */
const MATHML_TAG_NAMES = [
  "annotation",
  "math",
  "menclose",
  "merror",
  "mfrac",
  "mi",
  "mlabeledtr",
  "mmultiscripts",
  "mn",
  "mo",
  "mover",
  "mpadded",
  "mphantom",
  "mprescripts",
  "mroot",
  "mrow",
  "ms",
  "mspace",
  "msqrt",
  "mstyle",
  "msub",
  "msubsup",
  "msup",
  "mtable",
  "mtd",
  "mtext",
  "mtr",
  "munder",
  "munderover",
  "none",
  "semantics",
];

/** The ARIA names generated markup may carry on any element. */
const ARIA_PROPERTY_NAMES = [
  "ariaDescribedBy",
  "ariaLabel",
  "ariaLabelledBy",
  "ariaHidden",
  "role",
];

/**
 * Generated markup — KaTeX HTML, MathML, and SVG, plus the footnote anchors.
 * Differs from the raw policy only in element names, unrestricted
 * `className`/`role`/`aria*`, value-filtered `style`, the MathML and SVG
 * attributes, and no id clobber prefix. The origin is the trust boundary.
 */
export const generatedMarkupSanitizeSchema: Schema = {
  ...defaultSchema,
  clobberPrefix: "",
  tagNames: [...(defaultSchema.tagNames ?? []), ...MATHML_TAG_NAMES, "svg", "path"],
  attributes: {
    ...defaultSchema.attributes,
    "*": [...(defaultSchema.attributes?.["*"] ?? []), ...ARIA_PROPERTY_NAMES],
    span: [...(defaultSchema.attributes?.span ?? []), "className", "style"],
    div: [...(defaultSchema.attributes?.div ?? []), "className", "style"],
    sup: [...(defaultSchema.attributes?.sup ?? []), "className"],
    // A literal copy of the default `a` list with `className` unrestricted.
    a: [
      "ariaDescribedBy",
      "ariaLabel",
      "ariaLabelledBy",
      "dataFootnoteBackref",
      "dataFootnoteRef",
      "className",
      "href",
    ],
    math: ["xmlns", "display"],
    annotation: ["encoding"],
    mi: ["mathvariant"],
    mo: [
      "fence",
      "stretchy",
      "symmetric",
      "lspace",
      "rspace",
      "minsize",
      "maxsize",
      "separator",
      "form",
    ],
    mfrac: ["linethickness", "bevelled"],
    mover: ["accent"],
    munder: ["accentunder"],
    munderover: ["accent", "accentunder"],
    mpadded: ["width", "height", "depth", "lspace"],
    mspace: ["width", "height", "depth"],
    mstyle: ["mathcolor", "mathbackground", "displaystyle", "scriptlevel"],
    mtable: [
      "columnalign",
      "columnlines",
      "columnspacing",
      "rowspacing",
      "rowlines",
      "frame",
      "framespacing",
    ],
    mtr: ["columnalign", "rowalign"],
    mtd: ["columnalign", "rowalign", "columnspan", "rowspan"],
    menclose: ["notation"],
    svg: ["xmlns", "width", "height", "viewBox", "preserveAspectRatio", "style"],
    path: ["d"],
  },
};

/**
 * The layout declarations KaTeX needs. `hast-util-sanitize` matches whole
 * attribute values, so the filter below keeps and drops single declarations.
 */
const LAYOUT_STYLE_PROPERTIES = new Set([
  "height",
  "width",
  "min-height",
  "min-width",
  "max-height",
  "max-width",
  "margin",
  "margin-top",
  "margin-right",
  "margin-bottom",
  "margin-left",
  "padding",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
  "top",
  "right",
  "bottom",
  "left",
  "vertical-align",
  "transform",
]);

/** `color` survives only as `transparent` or `inherit`: the error red must go. */
const isAllowedDeclaration = (name: string, value: string): boolean =>
  LAYOUT_STYLE_PROPERTIES.has(name) ||
  name.startsWith("border-") ||
  (name === "color" && (value === "transparent" || value === "inherit"));

const filterStyleDeclarations = (value: string): string =>
  value
    .split(";")
    .map((declaration) => declaration.trim())
    .filter((declaration) => {
      const [name = "", ...rest] = declaration.split(":");
      return declaration !== "" && isAllowedDeclaration(name.trim(), rest.join(":").trim());
    })
    .join(";");

/** Walk the sanitized tree, filter `style`, and delete the property when empty. */
const filterGeneratedStyles = (nodes: ElementContent[]): void => {
  for (const node of nodes) {
    if (node.type !== "element") continue;
    const style = node.properties.style;
    if (typeof style === "string") {
      const filtered = filterStyleDeclarations(style);
      if (filtered === "") delete node.properties.style;
      else node.properties.style = filtered;
    }
    filterGeneratedStyles(node.children);
  }
};

/** Which allowlist a fragment crosses: raw authored HTML, or generated markup. */
export type FragmentOrigin = "raw" | "generated";

/**
 * Parse one fragment and sanitize it on its own. Whole-document parsing would
 * let an unclosed container swallow the blocks after it, so every raw fragment
 * and every inline run crosses this boundary alone.
 */
export const sanitizeFragment = (
  fragment: string,
  origin: FragmentOrigin = "raw",
): ElementContent[] => {
  const schema = origin === "generated" ? generatedMarkupSanitizeSchema : rawHtmlSanitizeSchema;
  const tree = sanitize(fromHtml(fragment, { fragment: true }), schema) as Root;
  const children = tree.children.filter(
    (node): node is ElementContent => node.type === "text" || node.type === "element",
  );
  if (origin === "generated") filterGeneratedStyles(children);
  return children;
};
