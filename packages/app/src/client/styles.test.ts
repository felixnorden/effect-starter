import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const clientDir = fileURLToPath(new URL(".", import.meta.url));

/**
 * CSS Color 4 named colours, aliases included. `transparent`, `currentcolor`,
 * and `inherit` are keywords rather than colour literals and are not listed.
 * The scan is deliberately limited to the client component files: styles.css is
 * the only theme file, and a colour there is expected.
 */
const NAMED_COLOURS = [
  "aliceblue",
  "antiquewhite",
  "aqua",
  "aquamarine",
  "azure",
  "beige",
  "bisque",
  "black",
  "blanchedalmond",
  "blue",
  "blueviolet",
  "brown",
  "burlywood",
  "cadetblue",
  "chartreuse",
  "chocolate",
  "coral",
  "cornflowerblue",
  "cornsilk",
  "crimson",
  "cyan",
  "darkblue",
  "darkcyan",
  "darkgoldenrod",
  "darkgray",
  "darkgreen",
  "darkgrey",
  "darkkhaki",
  "darkmagenta",
  "darkolivegreen",
  "darkorange",
  "darkorchid",
  "darkred",
  "darksalmon",
  "darkseagreen",
  "darkslateblue",
  "darkslategray",
  "darkslategrey",
  "darkturquoise",
  "darkviolet",
  "deeppink",
  "deepskyblue",
  "dimgray",
  "dimgrey",
  "dodgerblue",
  "firebrick",
  "floralwhite",
  "forestgreen",
  "fuchsia",
  "gainsboro",
  "ghostwhite",
  "gold",
  "goldenrod",
  "gray",
  "green",
  "greenyellow",
  "grey",
  "honeydew",
  "hotpink",
  "indianred",
  "indigo",
  "ivory",
  "khaki",
  "lavender",
  "lavenderblush",
  "lawngreen",
  "lemonchiffon",
  "lightblue",
  "lightcoral",
  "lightcyan",
  "lightgoldenrodyellow",
  "lightgray",
  "lightgreen",
  "lightgrey",
  "lightpink",
  "lightsalmon",
  "lightseagreen",
  "lightskyblue",
  "lightslategray",
  "lightslategrey",
  "lightsteelblue",
  "lightyellow",
  "lime",
  "limegreen",
  "linen",
  "magenta",
  "maroon",
  "mediumaquamarine",
  "mediumblue",
  "mediumorchid",
  "mediumpurple",
  "mediumseagreen",
  "mediumslateblue",
  "mediumspringgreen",
  "mediumturquoise",
  "mediumvioletred",
  "midnightblue",
  "mintcream",
  "mistyrose",
  "moccasin",
  "navajowhite",
  "navy",
  "oldlace",
  "olive",
  "olivedrab",
  "orange",
  "orangered",
  "orchid",
  "palegoldenrod",
  "palegreen",
  "paleturquoise",
  "palevioletred",
  "papayawhip",
  "peachpuff",
  "peru",
  "pink",
  "plum",
  "powderblue",
  "purple",
  "rebeccapurple",
  "red",
  "rosybrown",
  "royalblue",
  "saddlebrown",
  "salmon",
  "sandybrown",
  "seagreen",
  "seashell",
  "sienna",
  "silver",
  "skyblue",
  "slateblue",
  "slategray",
  "slategrey",
  "snow",
  "springgreen",
  "steelblue",
  "tan",
  "teal",
  "thistle",
  "tomato",
  "turquoise",
  "violet",
  "wheat",
  "white",
  "whitesmoke",
  "yellow",
  "yellowgreen",
] as const;

const COLOUR_LITERAL = new RegExp(
  [
    "#[0-9a-fA-F]{3,8}\\b",
    "\\brgba?\\(",
    "\\bhsla?\\(",
    `\\b(?:${NAMED_COLOURS.join("|")})\\b`,
  ].join("|"),
  "iu",
);

const componentFiles = (): string[] =>
  readdirSync(clientDir).filter(
    (file) =>
      (file.endsWith(".ts") || file.endsWith(".tsx")) &&
      !file.endsWith(".test.ts") &&
      !file.endsWith(".test.tsx"),
  );

const ROLE_NAMES = [
  "--color-bg",
  "--color-surface",
  "--color-fg",
  "--color-muted",
  "--color-border",
  "--color-accent",
  "--color-banner-bg",
  "--color-banner-fg",
  "--color-button-bg",
  "--radius",
] as const;

const stylesheet = (): string => readFileSync(path.join(clientDir, "styles.css"), "utf8");

const rootBlock = (css: string): string => {
  const start = css.indexOf(":root");
  return css.slice(start, css.indexOf("}", start) + 1);
};

/** A declaration's value, without the trailing semicolon. */
const declaredValue = (block: string, name: string): string | undefined =>
  new RegExp(`${name}\\s*:\\s*([^;]+);`, "u").exec(block)?.[1]?.trim();

describe("theme styles", () => {
  it("aliases every page role onto a daisyUI token, without a value", () => {
    const block = rootBlock(stylesheet());

    for (const name of ROLE_NAMES) {
      const value = declaredValue(block, name);
      expect(value, `${name} is declared`).toBeDefined();
      expect(value, `${name} aliases a token`).toMatch(
        /^(?:var\(--(?:color|radius)-|color-mix\()/u,
      );
    }

    expect(declaredValue(block, "--color-bg")).toBe("var(--color-base-100)");
    expect(declaredValue(block, "--color-fg")).toBe("var(--color-base-content)");
    expect(declaredValue(block, "--color-banner-bg")).toBe("var(--color-warning)");
    expect(declaredValue(block, "--color-banner-fg")).toBe("var(--color-warning-content)");
  });

  it("declares no colour value and no second palette block", () => {
    const css = stylesheet();

    expect(css.match(/:root/g)).toHaveLength(1);
    expect(css).not.toContain("[data-theme=");
    expect(css).not.toContain("color-scheme:");
    expect(css).not.toMatch(COLOUR_LITERAL);
    expect(css).not.toMatch(/\boklch?\(/iu);
  });

  it("consumes role variables and no colour literal for fences", () => {
    const css = stylesheet();
    const shiki = css.slice(css.indexOf(".shiki"), css.indexOf("}", css.indexOf(".shiki")) + 1);
    const pre = css.slice(css.indexOf(".preview-body pre"), css.indexOf(".preview-body img"));

    expect(shiki).toContain("background: var(--mdv-background)");
    expect(shiki).toContain("color: var(--mdv-foreground)");
    expect(shiki).not.toMatch(COLOUR_LITERAL);
    expect(pre).not.toContain("--color-code-bg");
  });

  it("scopes the token rule to the role variables", () => {
    const css = stylesheet();

    expect(css).not.toContain("--shiki-light");
    expect(css).not.toContain("--shiki-dark");
    expect(css).toContain("color: var(--mdv-foreground)");
  });

  it("numbers lines through a counter scoped to the attribute", () => {
    const css = stylesheet();

    expect(css).toContain("counter-reset: mdv-line;");
    expect(css).toContain('[data-line-numbers="on"] .shiki .line::before');
    expect(css).toContain("counter-increment: mdv-line;");
    expect(css).toContain("content: counter(mdv-line);");
  });

  it("paints the gutter from the sheet's role variable", () => {
    const css = stylesheet();
    const gutter = css.slice(
      css.indexOf('[data-line-numbers="on"] .shiki .line::before'),
      css.indexOf("}", css.indexOf('[data-line-numbers="on"] .shiki .line::before')),
    );

    expect(gutter).toContain("color: var(--mdv-token-comment)");
    expect(gutter).not.toContain("--color-muted");
    expect(gutter).not.toMatch(COLOUR_LITERAL);
  });

  it("guards the phantom line", () => {
    const css = stylesheet();

    expect(css).toContain(".shiki .line:last-child:empty::before");
    expect(css).toContain("genuinely blank final source line");
  });

  it("contains no colour literal outside the theme file", () => {
    const offenders = componentFiles().filter((file) =>
      COLOUR_LITERAL.test(readFileSync(path.join(clientDir, file), "utf8")),
    );

    expect(offenders).toEqual([]);
  });

  it("keeps the affordances reachable and reveals them without reflow", () => {
    const css = stylesheet();

    expect(css).toContain("opacity: 0");
    expect(css).toContain("pointer-events: none");
    expect(css).not.toContain("visibility: hidden");
    for (const selector of ["[data-block-id]:hover", "[data-block-id]:focus-within"]) {
      expect(css, selector).toContain(selector);
    }
    // A link carries no control, so no reveal rule should name one.
    expect(css).not.toContain("[data-mdv-link]");
    expect(css).toContain("position: absolute");
    expect(css).toContain("@media (prefers-reduced-motion: no-preference)");
    expect(css).toContain("@media (hover: none)");
    expect(css).toContain("position: static");
  });
});
