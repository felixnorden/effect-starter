import { useId, useLayoutEffect, useRef, type ReactNode } from "react";

import type { Display, ThemeSlot } from "./display.ts";
import { optionsForMode } from "./display.ts";
import { pageThemesFor, type PageThemeScheme } from "./page-theme.ts";
import type { SidebarState } from "./sidebar-state.ts";
import {
  SCALE_PRESETS,
  WIDTH_PRESETS,
  type PresetAxis,
  type Presets,
  type ScalePreset,
  type WidthPreset,
} from "./view-presets.ts";

type DataAttribute = `data-${string}`;

const WIDTH_LABELS: Record<WidthPreset, string> = {
  narrow: "Narrow",
  normal: "Normal",
  wide: "Wide",
};

const SCALE_LABELS: Record<ScalePreset, string> = {
  small: "Small",
  normal: "Normal",
  large: "Large",
};

/** Three rules of increasing length: the width preset as a picture. */
const WIDTH_GLYPHS: Record<WidthPreset, readonly [number, number, number]> = {
  narrow: [6, 8, 6],
  normal: [10, 12, 10],
  wide: [14, 16, 14],
};

const SCALE_GLYPHS: Record<ScalePreset, string> = {
  small: "A−",
  normal: "A",
  large: "A+",
};

const SCALE_SIZES: Record<ScalePreset, string> = {
  small: "text-xs",
  normal: "text-sm",
  large: "text-base",
};

/** A rectangle with one side filled: the panel, not the page it sits beside. */
const PanelIcon = () => (
  <svg
    className="size-4"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    role="presentation"
  >
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M15 4v16" />
  </svg>
);

/** The one control: it sits at the top of the panel and travels with it. */
const PanelToggle = ({
  state,
  onToggle,
}: {
  readonly state: SidebarState;
  readonly onToggle: () => void;
}) => (
  <button
    type="button"
    className="preview-panel-toggle btn btn-sm btn-ghost btn-square hover:bg-base-content/10 aria-expanded:bg-base-content/20"
    aria-label="Settings"
    aria-expanded={state === "open"}
    aria-controls="preview-panel"
    onClick={onToggle}
  >
    <PanelIcon />
  </button>
);

/**
 * One state vocabulary for every chip in the panel: the theme's foreground
 * tinted onto the surface, so a light theme darkens and a dark theme lightens.
 * daisyUI's own hover darkens the surface directly, which vanishes on dark
 * themes.
 */
const TOGGLE_CLASS =
  "btn btn-sm btn-ghost hover:bg-base-content/10 aria-pressed:bg-base-content/20 aria-pressed:hover:bg-base-content/25";

/** A join segment: one shared border, and the same state vocabulary. */
const SEGMENT_CLASS = `${TOGGLE_CLASS} join-item flex-1 border-base-300 px-0`;

type ToggleButtonProps = {
  /** The stable accessible name the tests query by. */
  readonly label: string;
  /** The same words as a native tooltip, for pointer users. */
  readonly title?: string;
  readonly pressed: boolean;
  readonly className?: string;
  readonly onClick: () => void;
  readonly children: ReactNode;
};

const ToggleButton = ({
  label,
  title,
  pressed,
  className,
  onClick,
  children,
}: ToggleButtonProps) => (
  <button
    type="button"
    className={className === undefined ? TOGGLE_CLASS : `${TOGGLE_CLASS} ${className}`}
    aria-label={label}
    title={title}
    aria-pressed={pressed}
    onClick={onClick}
  >
    {children}
  </button>
);

const SunIcon = () => (
  <svg className="swap-off size-4 fill-current" viewBox="0 0 24 24" role="presentation">
    <path d="M5.64,17l-.71.71a1,1,0,0,0,0,1.41,1,1,0,0,0,1.41,0l.71-.71A1,1,0,0,0,5.64,17ZM5,12a1,1,0,0,0-1-1H3a1,1,0,0,0,0,2H4A1,1,0,0,0,5,12Zm7-7a1,1,0,0,0,1-1V3a1,1,0,0,0-2,0V4A1,1,0,0,0,12,5ZM5.64,7.05a1,1,0,0,0,.7.29,1,1,0,0,0,.71-.29,1,1,0,0,0,0-1.41l-.71-.71A1,1,0,0,0,4.93,6.34Zm12,.29a1,1,0,0,0,.7-.29l.71-.71a1,1,0,1,0-1.41-1.41L17,5.64a1,1,0,0,0,0,1.41A1,1,0,0,0,17.66,7.34ZM21,11H20a1,1,0,0,0,0,2h1a1,1,0,0,0,0-2Zm-9,8a1,1,0,0,0-1,1v1a1,1,0,0,0,2,0V20A1,1,0,0,0,12,19ZM18.36,17A1,1,0,0,0,17,18.36l.71.71a1,1,0,0,0,1.41,0,1,1,0,0,0,0-1.41ZM12,6.5A5.5,5.5,0,1,0,17.5,12,5.51,5.51,0,0,0,12,6.5Zm0,9A3.5,3.5,0,1,1,15.5,12,3.5,3.5,0,0,1,12,15.5Z" />
  </svg>
);

const MoonIcon = () => (
  <svg className="swap-on size-4 fill-current" viewBox="0 0 24 24" role="presentation">
    <path d="M21.64,13a1,1,0,0,0-1.05-.14,8.05,8.05,0,0,1-3.37.73A8.15,8.15,0,0,1,9.08,5.49a8.59,8.59,0,0,1,.25-2A1,1,0,0,0,8,2.36,10.14,10.14,0,1,0,22,14.05,1,1,0,0,0,21.64,13Zm-9.5,6.69A8.14,8.14,0,0,1,7.08,5.22v.27A10.15,10.15,0,0,0,17.22,15.63a9.79,9.79,0,0,0,2.1-.22A8.11,8.11,0,0,1,12.14,19.73Z" />
  </svg>
);

const ModeToggle = ({
  mode,
  onToggle,
}: {
  readonly mode: PageThemeScheme;
  readonly onToggle: () => void;
}) => (
  <ToggleButton
    label="Dark mode"
    pressed={mode === "dark"}
    className="btn-square"
    onClick={onToggle}
  >
    <span
      className={mode === "dark" ? "swap swap-rotate swap-active" : "swap swap-rotate"}
      aria-hidden="true"
    >
      <SunIcon />
      <MoonIcon />
    </span>
  </ToggleButton>
);

const LineNumbersToggle = ({
  on,
  onToggle,
}: {
  readonly on: boolean;
  readonly onToggle: () => void;
}) => (
  <ToggleButton
    label="Line numbers"
    pressed={on}
    className="btn-square"
    title="Line numbers"
    onClick={onToggle}
  >
    <span className="preview-hash" aria-hidden="true">
      #
    </span>
  </ToggleButton>
);

type LabelledSelectProps = {
  /** The visible label; omitted when a row already names the control. */
  readonly label?: string;
  /** The stable accessible name the tests query by. */
  readonly name: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly data: Readonly<Partial<Record<DataAttribute, string>>>;
  readonly children: ReactNode;
};

/** One shape for every select: optional visible label, stable name, full width. */
const LabelledSelect = ({ label, name, value, onChange, data, children }: LabelledSelectProps) => {
  const id = useId();

  return (
    <span className="preview-field">
      {label === undefined ? null : <label htmlFor={id}>{label}</label>}
      <select
        id={id}
        className="select select-sm hover:border-base-content/40"
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

/** One width glyph: the three rules shorten or widen together. */
const WidthGlyph = ({ lines }: { readonly lines: readonly [number, number, number] }) => (
  <svg className="size-4" viewBox="0 0 16 16" fill="currentColor" role="presentation">
    {lines.map((width, index) => (
      <rect
        key={index}
        x={(16 - width) / 2}
        y={4 + index * 4}
        width={width}
        height="1.5"
        rx="0.75"
      />
    ))}
  </svg>
);

type PresetOption = {
  readonly value: string;
  readonly name: string;
  readonly content: ReactNode;
};

type PresetJoinProps = {
  /** The visible field label; it also names the group. */
  readonly label: string;
  readonly axis: PresetAxis;
  readonly value: string;
  readonly options: readonly PresetOption[];
  readonly onChange: (axis: PresetAxis, value: string) => void;
};

/** One axis as a daisyUI join: every value stays visible, so no dropdown is needed. */
const PresetJoin = ({ label, axis, value, options, onChange }: PresetJoinProps) => {
  const id = useId();

  return (
    <span className="preview-field">
      <span className="preview-field-label" id={id}>
        {label}
      </span>
      <div className="join w-full" role="group" aria-labelledby={id} data-preset-axis={axis}>
        {options.map((option) => (
          <button
            type="button"
            key={option.value}
            className={SEGMENT_CLASS}
            aria-label={option.name}
            aria-pressed={value === option.value}
            onClick={() => onChange(axis, option.value)}
          >
            <span className="preview-preset-glyph" aria-hidden="true">
              {option.content}
            </span>
          </button>
        ))}
      </div>
    </span>
  );
};

/** One titled area of effect: the whole page, the document measure, or code. */
const Group = ({ title, children }: { readonly title: string; readonly children: ReactNode }) => {
  const id = useId();

  return (
    <section className="preview-group" aria-labelledby={id}>
      <h2 className="preview-group-title" id={id}>
        {title}
      </h2>
      {children}
    </section>
  );
};

/** How long the card's box travels between the rail and the panel. */
const MORPH_MS = 160;

/** Names the card's own animation, so a second toggle replaces it alone. */
const MORPH_ID = "preview-panel-morph";

type Box = { readonly width: number; readonly height: number };

const boxOf = (element: HTMLElement): Box => {
  const { width, height } = element.getBoundingClientRect();
  return { width, height };
};

const reduceMotion = (): boolean => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const runningMorph = (card: HTMLElement): Animation | undefined =>
  card.getAnimations().find((animation) => animation.id === MORPH_ID);

/** Only one card morphs at a time; the latest one owns the clip flag. */
let morphCount = 0;

/**
 * Travel the card's box from `from` to the box its new state asks for, and
 * return that target. The height follows the content, which CSS cannot
 * transition, so both axes are animated here: the card grows into its new
 * shape instead of popping tall and then shrinking.
 */
const morphCard = (card: HTMLElement, from: Box): Box => {
  morphCount += 1;
  const token = morphCount;
  runningMorph(card)?.cancel();
  const to = boxOf(card);
  if (reduceMotion() || (from.width === to.width && from.height === to.height)) return to;

  // While the box is smaller than its content a scrollbar would appear and
  // shift every control; clip instead, and let the body fade in at the end.
  card.dataset.morphing = "true";
  const animation = card.animate(
    [
      { width: `${from.width}px`, height: `${from.height}px` },
      { width: `${to.width}px`, height: `${to.height}px` },
    ],
    { id: MORPH_ID, duration: MORPH_MS, easing: "cubic-bezier(0.2, 0, 0, 1)" },
  );
  let finished = false;
  const finish = (): void => {
    if (finished) return;
    finished = true;
    // A newer morph owns the card now; it clears the flag itself.
    if (token === morphCount) delete card.dataset.morphing;
    animation.cancel();
  };
  animation.onfinish = finish;
  animation.oncancel = finish;

  return to;
};

export type SidebarProps = {
  readonly state: SidebarState;
  readonly mode: PageThemeScheme;
  readonly pageTheme: string;
  readonly display: Display;
  readonly presets: Presets;
  readonly onToggleSidebar: () => void;
  readonly onToggleMode: () => void;
  readonly onPageThemeChange: (name: string) => void;
  readonly onThemeChange: (slot: ThemeSlot, id: string) => void;
  readonly onToggleLineNumbers: () => void;
  readonly onPresetChange: (axis: PresetAxis, value: string) => void;
};

/**
 * Presentation only: values in, callbacks out, no state, no persistence.
 * A floating card: the rail keeps the toggle and the two switches; every
 * option lives in the open panel.
 */
export const Sidebar = ({
  state,
  mode,
  pageTheme,
  display,
  presets,
  onToggleSidebar,
  onToggleMode,
  onPageThemeChange,
  onThemeChange,
  onToggleLineNumbers,
  onPresetChange,
}: SidebarProps) => {
  const card = useRef<HTMLElement | null>(null);
  const settled = useRef<{ readonly state: SidebarState; readonly box: Box } | null>(null);

  // The box the last settled render had; a state change morphs from it.
  useLayoutEffect(() => {
    const element = card.current;
    if (element === null) return;
    const previous = settled.current;
    const running = runningMorph(element) !== undefined;

    if (previous === null || previous.state === state) {
      if (!running) settled.current = { state, box: boxOf(element) };
      return;
    }

    // Mid-flight the live box is the honest start; at rest the stored one is.
    const from = running ? boxOf(element) : previous.box;
    settled.current = { state, box: morphCard(element, from) };
  }, [state]);

  return (
    <aside
      id="preview-panel"
      ref={card}
      className="preview-sidebar card"
      data-state={state}
      aria-label="Settings"
    >
      <PanelToggle state={state} onToggle={onToggleSidebar} />

      {state === "rail" ? (
        <>
          <ModeToggle mode={mode} onToggle={onToggleMode} />
          <LineNumbersToggle on={display.lineNumbers} onToggle={onToggleLineNumbers} />
        </>
      ) : (
        <>
          <Group title="Appearance">
            <div className="preview-row">
              <ModeToggle mode={mode} onToggle={onToggleMode} />
              <LabelledSelect
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
            <div className="preview-row preview-row-end">
              <LabelledSelect
                label="Code theme"
                name="Code theme"
                value={display[mode].id}
                onChange={(id) => onThemeChange(mode, id)}
                data={{ "data-theme-select": mode }}
              >
                {optionsForMode(mode).map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </LabelledSelect>
              <LineNumbersToggle on={display.lineNumbers} onToggle={onToggleLineNumbers} />
            </div>
          </Group>

          <Group title="Reading">
            <PresetJoin
              label="Reading width"
              axis="width"
              value={presets.width}
              options={WIDTH_PRESETS.map((preset) => ({
                value: preset,
                name: WIDTH_LABELS[preset],
                content: <WidthGlyph lines={WIDTH_GLYPHS[preset]} />,
              }))}
              onChange={onPresetChange}
            />
            <PresetJoin
              label="Font scale"
              axis="scale"
              value={presets.scale}
              options={SCALE_PRESETS.map((preset) => ({
                value: preset,
                name: SCALE_LABELS[preset],
                content: <span className={SCALE_SIZES[preset]}>{SCALE_GLYPHS[preset]}</span>,
              }))}
              onChange={onPresetChange}
            />
          </Group>
        </>
      )}
    </aside>
  );
};
