import type { SessionMessage } from "@mdv/core/protocol";

import { sheetUrl, type Display } from "./display.ts";
import type { Theme } from "./theme.ts";

/** The storage key that records the configured mode a manual choice was made under. */
export const THEME_MODE_KEY = "preview-theme-mode";

export type ThemeChoiceInput = {
  /** The member's configured mode, or `null` before the first member. */
  readonly configured: SessionMessage["themeMode"] | null;
  readonly stored: Theme | null;
  readonly storedMode: string | null;
  readonly system: Theme;
};

/**
 * Configuration first, then a stored manual toggle chosen under that same mode,
 * then the system preference. A stored toggle under another mode is discarded.
 */
export const resolveSessionTheme = (input: ThemeChoiceInput): Theme => {
  const configured = input.configured ?? "system";
  if (input.stored !== null && input.storedMode === configured) return input.stored;
  return configured === "system" ? input.system : configured;
};

/** The heading is the session title, else the document title, else the file name. */
export const headingOf = (
  session: SessionMessage | null,
  title: string | null,
  fileName: string | null,
): string | null => session?.title ?? title ?? session?.fileName ?? fileName;

/** Header visibility hides the file-name line and leaves the heading. */
export const fileNameLineOf = (
  session: SessionMessage | null,
  title: string | null,
  fileName: string | null,
): string | null => {
  if (session !== null) return session.showFileName ? session.fileName : null;
  return title === null ? null : fileName;
};

/** The two layout values become two custom properties on the content element. */
export const layoutStyleOf = (
  session: SessionMessage | null,
): Record<"--preview-width" | "--preview-font-size", string> | undefined =>
  session === null
    ? undefined
    : {
        "--preview-width": session.width,
        "--preview-font-size": session.fontSize,
      };

export type SheetSlot = "light" | "dark" | "markdown" | "code";

export type SheetLink = {
  readonly slot: SheetSlot;
  readonly href: string;
};

/**
 * The pinned cascade: the mode sheets first, then the configured markdown sheet,
 * then the configured code sheet, which must win over the mode sheet (G-13).
 */
export const sheetLinks = (
  display: Display,
  session: SessionMessage | null,
): readonly SheetLink[] => [
  { slot: "light", href: sheetUrl(display.light.id) },
  { slot: "dark", href: sheetUrl(display.dark.id) },
  ...(session?.markdownCss === null || session?.markdownCss === undefined
    ? []
    : [{ slot: "markdown" as const, href: session.markdownCss }]),
  ...(session?.codeCss === null || session?.codeCss === undefined
    ? []
    : [{ slot: "code" as const, href: session.codeCss }]),
];
