import type { RefObject } from "react";

import type { PreviewState } from "./store.ts";
import type { Theme } from "./theme.ts";

import { BlockList } from "./blocks.tsx";

export type AppProps = {
  readonly state: PreviewState;
  readonly theme?: Theme;
  readonly onToggleTheme?: () => void;
  /** The element the scroll anchor measures; the page owns the shell. */
  readonly containerRef?: RefObject<HTMLElement | null>;
};

export const App = ({ state, theme, onToggleTheme, containerRef }: AppProps) => {
  // The page owns the single h1: the title, else the file name.
  const heading = state.title ?? state.fileName;

  return (
    <div className="preview-shell">
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
      </header>

      <main className="preview-main" ref={containerRef}>
        {state.banner === null ? null : (
          <div role="alert" className="preview-banner">
            {state.banner.stage}: {state.banner.message}
          </div>
        )}

        <article className="preview-body">
          <BlockList order={state.order} blocks={state.blocks} />
        </article>
      </main>
    </div>
  );
};
