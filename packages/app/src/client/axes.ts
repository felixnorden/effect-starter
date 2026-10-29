import type { PageThemeScheme } from "./page-theme.ts";
import type { ScalePreset, WidthPreset } from "./view-presets.ts";

/** The root attribute the generated code-theme sheets are keyed on. */
export const COLOR_MODE_ATTRIBUTE = "data-color-mode";

/** Everything the page paints from: one theme, one mode, two presets. */
export type View = {
  readonly pageTheme: string;
  readonly colorMode: PageThemeScheme;
  readonly width: WidthPreset;
  readonly scale: ScalePreset;
};

/** The one write site: four attributes, no reading, no persistence. */
export const applyView = (
  view: View,
  root: { setAttribute(name: string, value: string): void },
): void => {
  root.setAttribute("data-theme", view.pageTheme);
  root.setAttribute(COLOR_MODE_ATTRIBUTE, view.colorMode);
  root.setAttribute("data-width", view.width);
  root.setAttribute("data-scale", view.scale);
};
