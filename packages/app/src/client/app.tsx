import type { ChangeEvent, CSSProperties, RefObject } from "react";

import type { Display, ThemeSlot } from "./display.ts";
import { optionsForMode } from "./display.ts";
import { fileNameLineOf, headingOf, layoutStyleOf, sheetLinks } from "./session.ts";
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
  /** Set when the socket closes; the page then names the restart command. */
  readonly ended?: string | null;
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
  ended,
}: AppProps) => {
  const heading = headingOf(state.session, state.title, state.fileName);
  const fileLine = fileNameLineOf(state.session, state.title, state.fileName);

  return (
    <div
      className="preview-shell"
      style={layoutStyleOf(state.session) as CSSProperties | undefined}
    >
      {sheetLinks(display, state.session).map((link) => (
        <link
          key={link.slot}
          data-slot={link.slot}
          rel="stylesheet"
          href={link.href}
          precedence="mdv-code-theme"
        />
      ))}

      <header className="preview-header">
        {heading === null ? null : <h1 className="preview-title">{heading}</h1>}
        {fileLine === null ? null : <span className="preview-file-name">{fileLine}</span>}
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
        {ended === undefined || ended === null ? null : (
          <div role="alert" className="preview-banner">
            The preview ended: {ended}. Restart with :MarkdownPreview.
          </div>
        )}
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
