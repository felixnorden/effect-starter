export type Rgb = { readonly r: number; readonly g: number; readonly b: number };

const HEX_PATTERN = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/iu;
const RGB_PATTERN = /^rgba?\(\s*(\d+)\s*[, ]\s*(\d+)\s*[, ]\s*(\d+)/iu;

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
  if (rgb === null) return null;
  const [r, g, b] = [rgb[1], rgb[2], rgb[3]].map((part) => Number(part ?? ""));
  if (r === undefined || g === undefined || b === undefined) return null;
  return { r, g, b };
};

/** `#abc`, `#aabbcc`, `rgb(1 2 3)`, and `rgba(1, 2, 3, 1)`; null otherwise. */
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
