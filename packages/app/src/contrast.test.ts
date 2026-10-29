import { describe, expect, it } from "vitest";

import {
  contrastRatio,
  DECLARED_NON_TEXT_PAIRS,
  DECLARED_TEXT_PAIRS,
  parseColor,
  relativeLuminance,
  type Rgb,
} from "./contrast.ts";

/** One 8-bit step tolerates the rounding differences between colour spaces. */
const expectChannelTolerance = (actual: Rgb | null, expected: Rgb): void => {
  expect(actual).not.toBeNull();
  expect(Math.abs((actual as Rgb).r - expected.r)).toBeLessThanOrEqual(1);
  expect(Math.abs((actual as Rgb).g - expected.g)).toBeLessThanOrEqual(1);
  expect(Math.abs((actual as Rgb).b - expected.b)).toBeLessThanOrEqual(1);
};

const HIGH_CONTRAST_LIGHT_TOKENS = [
  "#66707b",
  "#a0111f",
  "#023b95",
  "#702c00",
  "#0e1116",
  "#622cbc",
  "#024c1a",
  "#032563",
  "#6e011a",
  "#4b535d",
];

describe("parseColor", () => {
  it("parses the three colour forms the browser reports", () => {
    expect(parseColor("#abc")).toEqual({ r: 0xaa, g: 0xbb, b: 0xcc });
    expect(parseColor("#aabbcc")).toEqual({ r: 0xaa, g: 0xbb, b: 0xcc });
    expect(parseColor("rgb(1 2 3)")).toEqual({ r: 1, g: 2, b: 3 });
    expect(parseColor("rgba(1, 2, 3, 1)")).toEqual({ r: 1, g: 2, b: 3 });
  });

  it("returns null for a value the ratio maths cannot read", () => {
    expect(parseColor("transparent")).toBeNull();
    expect(parseColor("var(--x)")).toBeNull();
  });

  it("parses an OKLCH colour with percent lightness", () => {
    expectChannelTolerance(parseColor("oklch(100% 0 0)"), { r: 255, g: 255, b: 255 });
    expectChannelTolerance(parseColor("oklch(0% 0 0)"), { r: 0, g: 0, b: 0 });
  });

  it("parses number lightness, a hue with a unit, and a slash alpha", () => {
    const lightness = parseColor("oklch(0.5 0.1 200deg)");
    const alpha = parseColor("oklch(62% 0.19 259.81 / 50%)");
    const opaque = parseColor("oklch(62% 0.19 259.81)");
    const blue = parseColor("oklch(45% 0.24 277.023)");

    expect(lightness).not.toBeNull();
    expect(alpha).not.toBeNull();
    expect(opaque).not.toBeNull();
    expect(blue).not.toBeNull();
    // The alpha component does not change the channels the ratio maths reads.
    expectChannelTolerance(alpha, opaque as Rgb);
    expect(blue?.b ?? 0).toBeGreaterThan(blue?.r ?? 0);
  });

  it("treats a missing component as none and an Oklab value as an accepted form", () => {
    const oklch = parseColor("oklch(50% none none)");
    const oklab = parseColor("oklab(0.5 0 0)");

    expect(oklch).not.toBeNull();
    expect(oklab).not.toBeNull();
    expectChannelTolerance(oklch, oklab as Rgb);
  });

  it("fails loudly on a form the ratio maths cannot read", () => {
    expect(parseColor("var(--color-base-100)")).toBeNull();
    expect(parseColor("color-mix(in oklab, oklch(1 0 0), oklch(0 0 0))")).toBeNull();
    expect(parseColor("transparent")).toBeNull();
  });
});

describe("relativeLuminance", () => {
  it("computes black and white", () => {
    expect(relativeLuminance({ r: 0, g: 0, b: 0 })).toBeCloseTo(0, 6);
    expect(relativeLuminance({ r: 255, g: 255, b: 255 })).toBeCloseTo(1, 6);
  });
});

describe("contrastRatio", () => {
  it("computes a known pair ratio", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeGreaterThan(20.9);
    expect(contrastRatio("#000000", "#ffffff")).toBeLessThan(21.1);
    expect(contrastRatio("#1f2328", "#ffffff")).toBeGreaterThan(15.5);
    expect(contrastRatio("#1f2328", "#ffffff")).toBeLessThan(16);
  });

  it("fails the shipped light token that motivated AR-3", () => {
    const ratio = contrastRatio("#E36209", "#f6f8fa");

    expect(ratio).toBeGreaterThan(3.26);
    expect(ratio).toBeLessThan(3.3);
    expect(ratio).toBeLessThan(4.5);
  });

  it("passes every high-contrast token", () => {
    for (const token of HIGH_CONTRAST_LIGHT_TOKENS) {
      expect(contrastRatio(token, "#f6f8fa")).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("returns null for an unparseable pair", () => {
    expect(contrastRatio("nope", "#fff")).toBeNull();
  });

  it("declares the ten text pairs over two variables each", () => {
    expect(DECLARED_TEXT_PAIRS).toHaveLength(10);
    for (const pair of DECLARED_TEXT_PAIRS) {
      expect(pair.foreground).toMatch(/^--(?:color|mdv)-/u);
      expect(pair.background).toMatch(/^--(?:color|mdv)-/u);
    }

    expect(DECLARED_TEXT_PAIRS).toContainEqual({
      foreground: "--mdv-token-comment",
      background: "--mdv-background",
    });
    expect(DECLARED_TEXT_PAIRS).toContainEqual({
      foreground: "--mdv-foreground",
      background: "--mdv-background",
    });
    expect(DECLARED_TEXT_PAIRS.some((pair) => pair.background === "--color-code-bg")).toBe(false);
  });

  it("declares the focus ring against both page surfaces", () => {
    expect(DECLARED_NON_TEXT_PAIRS).toHaveLength(2);
    expect(DECLARED_NON_TEXT_PAIRS).toContainEqual({
      foreground: "--color-accent",
      background: "--color-base-100",
    });
    expect(DECLARED_NON_TEXT_PAIRS).toContainEqual({
      foreground: "--color-accent",
      background: "--color-base-200",
    });
  });
});
