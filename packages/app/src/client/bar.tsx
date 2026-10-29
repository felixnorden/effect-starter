import { useId, type ReactNode, type RefObject } from "react";

import type { Display, ThemeSlot } from "./display.ts";
import { optionsForMode } from "./display.ts";
import { pageThemesFor, type PageThemeScheme } from "./page-theme.ts";
import { SCALE_PRESETS, WIDTH_PRESETS, type PresetAxis, type Presets } from "./view-presets.ts";

type DataAttribute = `data-${string}`;

const PRESET_LABELS: Record<string, string> = {
  narrow: "Narrow",
  normal: "Normal",
  wide: "Wide",
  small: "Small",
  large: "Large",
};

type LabelledSelectProps = {
  /** The short visible label; a prefix of the accessible name. */
  readonly label: string;
  /** The stable accessible name the tests query by. */
  readonly name: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly data: Readonly<Partial<Record<DataAttribute, string>>>;
  readonly children: ReactNode;
};

/** One shape for all five selects: visible label, stable name, daisyUI dress. */
const LabelledSelect = ({ label, name, value, onChange, data, children }: LabelledSelectProps) => {
  const id = useId();

  return (
    <span className="preview-field">
      <label htmlFor={id}>{label}</label>
      <select
        id={id}
        className="select select-sm"
        aria-label={name}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        {...data}
      >
        {children}
      </select>
    </span>
  );
};

export type BarProps = {
  readonly heading: string | null;
  readonly fileName: string | null;
  readonly mode: PageThemeScheme;
  readonly pageTheme: string;
  readonly display: Display;
  readonly presets: Presets;
  readonly statusRef?: RefObject<HTMLParagraphElement | null>;
  readonly onToggleMode: () => void;
  readonly onPageThemeChange: (name: string) => void;
  readonly onThemeChange: (slot: ThemeSlot, id: string) => void;
  readonly onToggleLineNumbers: () => void;
  readonly onPresetChange: (axis: PresetAxis, value: string) => void;
};

/** Presentation only: values in, callbacks out, no state, no persistence. */
export const Bar = ({
  heading,
  fileName,
  mode,
  pageTheme,
  display,
  presets,
  statusRef,
  onToggleMode,
  onPageThemeChange,
  onThemeChange,
  onToggleLineNumbers,
  onPresetChange,
}: BarProps) => (
  <header className="preview-header navbar bg-base-100 text-base-content" role="banner">
    <div className="preview-identity">
      {heading === null ? null : <h1 className="preview-title">{heading}</h1>}
      {fileName === null ? null : <span className="preview-file-name">{fileName}</span>}
    </div>

    <div className="preview-group" role="group" aria-label="Theme">
      <button
        type="button"
        className="btn btn-sm"
        aria-pressed={mode === "dark"}
        onClick={onToggleMode}
      >
        Dark mode
      </button>
      <LabelledSelect
        label="Page theme"
        name="Page theme"
        value={pageTheme}
        onChange={onPageThemeChange}
        data={{ "data-page-theme-select": mode }}
      >
        {pageThemesFor(mode).map((theme) => (
          <option key={theme.name} value={theme.name}>
            {theme.label}
          </option>
        ))}
      </LabelledSelect>
    </div>

    <div className="preview-group" role="group" aria-label="Code presentation">
      {(["light", "dark"] as const).map((slot) => (
        <LabelledSelect
          key={slot}
          label={slot === "light" ? "Light code" : "Dark code"}
          name={slot === "light" ? "Light code theme" : "Dark code theme"}
          value={display[slot].id}
          onChange={(id) => onThemeChange(slot, id)}
          data={{ "data-theme-select": slot }}
        >
          {optionsForMode(slot).map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </LabelledSelect>
      ))}
      <button
        type="button"
        className="btn btn-sm"
        aria-pressed={display.lineNumbers}
        onClick={onToggleLineNumbers}
      >
        Line numbers
      </button>
    </div>

    <div className="preview-group" role="group" aria-label="Reading">
      <LabelledSelect
        label="Width"
        name="Reading width"
        value={presets.width}
        onChange={(value) => onPresetChange("width", value)}
        data={{}}
      >
        {WIDTH_PRESETS.map((preset) => (
          <option key={preset} value={preset}>
            {PRESET_LABELS[preset]}
          </option>
        ))}
      </LabelledSelect>
      <LabelledSelect
        label="Scale"
        name="Font scale"
        value={presets.scale}
        onChange={(value) => onPresetChange("scale", value)}
        data={{}}
      >
        {SCALE_PRESETS.map((preset) => (
          <option key={preset} value={preset}>
            {PRESET_LABELS[preset]}
          </option>
        ))}
      </LabelledSelect>
    </div>

    <p className="preview-status" aria-live="polite" ref={statusRef} />
  </header>
);
