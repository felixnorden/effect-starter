export type Rgb = { readonly r: number; readonly g: number; readonly b: number };

const HEX_PATTERN = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/iu;
const RGB_PATTERN = /^rgba?\(\s*(\d+)\s*[, ]\s*(\d+)\s*[, ]\s*(\d+)/iu;
const OKLCH_PATTERN =
  /^oklch\(\s*([\d.]+)(%?)\s+([\d.]+|none)\s+(-?[\d.]+(?:deg|grad|rad|turn)?|none)\s*(?:\/\s*[\d.]+%?\s*)?\)$/iu;
const OKLAB_PATTERN =
  /^oklab\(\s*([\d.]+)(%?)\s+(-?[\d.]+)\s+(-?[\d.]+)\s*(?:\/\s*[\d.]+%?\s*)?\)$/iu;

const clampChannel = (value: number): number => Math.min(255, Math.max(0, Math.round(value)));

/** Linear sRGB → 8-bit gamma-encoded channels. */
const encodeChannel = (value: number): number => {
  const encoded =
    Math.abs(value) <= 0.0031308
      ? 12.92 * value
      : 1.055 * Math.sign(value) * Math.abs(value) ** (1 / 2.4) - 0.055;
  return clampChannel(encoded * 255);
};

/** OKLab → linear sRGB (Björn Ottosson's matrices), then the 8-bit encoding. */
const oklabToRgb = (lightness: number, a: number, b: number): Rgb => {
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;

  return {
    r: encodeChannel(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    g: encodeChannel(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    b: encodeChannel(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  };
};

const HUE_UNITS: Record<string, number> = { deg: 1, grad: 0.9, rad: 180 / Math.PI, turn: 360 };

const hueInDegrees = (value: string): number => {
  const unit = /(deg|grad|rad|turn)$/u.exec(value)?.[1];
  const number = Number.parseFloat(value);
  return unit === undefined ? number : number * (HUE_UNITS[unit] ?? 1);
};

const lightnessOf = (value: string, percent: string): number =>
  percent === "%" ? Number.parseFloat(value) / 100 : Number.parseFloat(value);

const toRgb = (value: string): Rgb | null => {
  const hex = HEX_PATTERN.exec(value);
  if (hex !== null) {
    const digits = value.slice(1);
    const expanded =
      digits.length === 3
        ? digits
            .split("")
            .map((digit) => `${digit}${digit}`)
            .join("")
        : digits;
    return {
      r: Number.parseInt(expanded.slice(0, 2), 16),
      g: Number.parseInt(expanded.slice(2, 4), 16),
      b: Number.parseInt(expanded.slice(4, 6), 16),
    };
  }

  const rgb = RGB_PATTERN.exec(value);
  if (rgb !== null) {
    const [r, g, b] = [rgb[1], rgb[2], rgb[3]].map((part) => Number(part ?? ""));
    if (r === undefined || g === undefined || b === undefined) return null;
    return { r, g, b };
  }

  const oklch = OKLCH_PATTERN.exec(value);
  if (oklch !== null) {
    const lightness = lightnessOf(oklch[1] ?? "", oklch[2] ?? "");
    const chroma = oklch[3] === "none" ? 0 : Number.parseFloat(oklch[3] ?? "");
    const hue = oklch[4] === "none" ? 0 : hueInDegrees(oklch[4] ?? "");
    const radians = (hue * Math.PI) / 180;
    return oklabToRgb(lightness, chroma * Math.cos(radians), chroma * Math.sin(radians));
  }

  const oklab = OKLAB_PATTERN.exec(value);
  if (oklab === null) return null;
  return oklabToRgb(
    lightnessOf(oklab[1] ?? "", oklab[2] ?? ""),
    Number.parseFloat(oklab[3] ?? ""),
    Number.parseFloat(oklab[4] ?? ""),
  );
};

/** `#abc`, `#aabbcc`, `rgb(1 2 3)`, `oklch(62% 0.19 259.81)`, `oklab(0.5 0 0)`; null otherwise. */
export const parseColor = (value: string): Rgb | null => toRgb(value.trim());

const channelLuminance = (value: number): number => {
  const channel = value / 255;
  return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
};

export const relativeLuminance = (color: Rgb): number =>
  0.2126 * channelLuminance(color.r) +
  0.7152 * channelLuminance(color.g) +
  0.0722 * channelLuminance(color.b);

/** The WCAG ratio, or null when either value cannot be parsed. */
export const contrastRatio = (foreground: string, background: string): number | null => {
  const fg = parseColor(foreground);
  const bg = parseColor(background);
  if (fg === null || bg === null) return null;

  const first = relativeLuminance(fg);
  const second = relativeLuminance(bg);
  const [high, low] = first >= second ? [first, second] : [second, first];
  return (high + 0.05) / (low + 0.05);
};

/** A text pair the page declares in CSS, named by its custom properties. */
export type DeclaredTextPair = {
  readonly foreground: string;
  readonly background: string;
};

/** The ten text pairs the browser suite samples in both themes. */
export const DECLARED_TEXT_PAIRS: readonly DeclaredTextPair[] = [
  { foreground: "--color-fg", background: "--color-bg" },
  { foreground: "--color-muted", background: "--color-bg" },
  { foreground: "--color-accent", background: "--color-bg" },
  { foreground: "--color-fg", background: "--color-surface" },
  { foreground: "--color-muted", background: "--color-surface" },
  { foreground: "--color-accent", background: "--color-surface" },
  { foreground: "--mdv-token-comment", background: "--mdv-background" },
  { foreground: "--mdv-foreground", background: "--mdv-background" },
  { foreground: "--color-banner-fg", background: "--color-banner-bg" },
  { foreground: "--color-accent", background: "--color-button-bg" },
];
