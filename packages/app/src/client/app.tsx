import type { ChangeEvent, RefObject } from "react";

import type { Display, ThemeSlot } from "./display.ts";
import { optionsForMode, sheetUrl } from "./display.ts";
import type { PreviewState } from "./store.ts";
import type { Theme } from "./theme.ts";

import { BlockList } from "./blocks.tsx";

export type AppProps = {
  readonly state: PreviewState;
  readonly display: Display;
  readonly onThemeChange: (slot: ThemeSlot, id: string) => void;
  readonly onToggleLineNumbers: () => void;
  readonly theme?: Theme;
  readonly onToggleTheme?: () => void;
  /** The element the scroll anchor measures; the page owns the shell. */
  readonly containerRef?: RefObject<HTMLElement | null>;
  readonly statusRef?: RefObject<HTMLParagraphElement | null>;
};

export const App = ({
  state,
  display,
  onThemeChange,
  onToggleLineNumbers,
  theme,
  onToggleTheme,
  containerRef,
  statusRef,
}: AppProps) => {
  // The page owns the single h1: the title, else the file name.
  const heading = state.title ?? state.fileName;

  return (
    <div className="preview-shell">
      <link
        data-slot="light"
        rel="stylesheet"
        href={sheetUrl(display.light.id)}
        precedence="mdv-code-theme"
      />
      <link
        data-slot="dark"
        rel="stylesheet"
        href={sheetUrl(display.dark.id)}
        precedence="mdv-code-theme"
      />

      <header className="preview-header">
        {heading === null ? null : <h1 className="preview-title">{heading}</h1>}
        {state.title === null || state.fileName === null ? null : (
          <span className="preview-file-name">{state.fileName}</span>
        )}
        {onToggleTheme === undefined ? null : (
          <button type="button" className="preview-theme-toggle" onClick={onToggleTheme}>
            {theme === "dark" ? "Light" : "Dark"}
          </button>
        )}
        <button
          type="button"
          className="preview-theme-toggle"
          aria-pressed={display.lineNumbers}
          onClick={onToggleLineNumbers}
        >
          Line numbers
        </button>
        <p className="preview-status" aria-live="polite" ref={statusRef} />
        {(["light", "dark"] as const).map((slot) => (
          <label key={slot} className="preview-theme-select">
            {slot === "light" ? "Light theme" : "Dark theme"}
            <select
              data-theme-select={slot}
              value={display[slot].id}
              onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                onThemeChange(slot, event.target.value)
              }
            >
              {optionsForMode(slot).map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        ))}
      </header>

      <main className="preview-main" ref={containerRef}>
        {state.banner === null ? null : (
          <div role="alert" className="preview-banner">
            {state.banner.stage}: {state.banner.message}
          </div>
        )}

        <article
          className="preview-body"
          data-line-numbers={display.lineNumbers ? "on" : undefined}
        >
          <BlockList order={state.order} blocks={state.blocks} />
        </article>
      </main>
    </div>
  );
};
