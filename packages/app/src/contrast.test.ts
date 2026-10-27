import { describe, expect, it } from "vitest";

import { contrastRatio, DECLARED_TEXT_PAIRS, parseColor, relativeLuminance } from "./contrast.ts";

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
});
