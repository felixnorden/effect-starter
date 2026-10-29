export const WIDTH_KEY = "preview-width";
export const SCALE_KEY = "preview-scale";

export const WIDTH_PRESETS = ["narrow", "normal", "wide"] as const;
export const SCALE_PRESETS = ["small", "normal", "large"] as const;

export type WidthPreset = (typeof WIDTH_PRESETS)[number];
export type ScalePreset = (typeof SCALE_PRESETS)[number];
export type PresetAxis = "width" | "scale";

export type Presets = {
  readonly width: WidthPreset;
  readonly scale: ScalePreset;
};

const isWidth = (value: string | null): value is WidthPreset =>
  WIDTH_PRESETS.some((preset) => preset === value);

const isScale = (value: string | null): value is ScalePreset =>
  SCALE_PRESETS.some((preset) => preset === value);

/** Enumerated values only; each axis falls back on its own. */
export const readPresets = (deps: { readonly storage: Storage }): Presets => {
  const width = deps.storage.getItem(WIDTH_KEY);
  const scale = deps.storage.getItem(SCALE_KEY);
  return {
    width: isWidth(width) ? width : "normal",
    scale: isScale(scale) ? scale : "normal",
  };
};

/** Write exactly one axis, and only when the value is offered. */
export const setPreset = (
  presets: Presets,
  axis: PresetAxis,
  value: string,
  deps: { readonly storage: Storage },
): Presets => {
  if (axis === "width") {
    if (!isWidth(value)) return presets;
    deps.storage.setItem(WIDTH_KEY, value);
    return { ...presets, width: value };
  }

  if (!isScale(value)) return presets;
  deps.storage.setItem(SCALE_KEY, value);
  return { ...presets, scale: value };
};
