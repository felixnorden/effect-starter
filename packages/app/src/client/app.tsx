import type { RefObject } from "react";

import type { Display, ThemeSlot } from "./display.ts";
import type { PageThemeScheme } from "./page-theme.ts";
import type { PreviewState } from "./store.ts";
import type { PresetAxis, Presets } from "./view-presets.ts";

import { Bar } from "./bar.tsx";
import { BlockList } from "./blocks.tsx";

export type AppProps = {
  readonly state: PreviewState;
  readonly display: Display;
  readonly mode: PageThemeScheme;
  readonly pageTheme: string;
  readonly presets: Presets;
  readonly onToggleMode: () => void;
  readonly onPageThemeChange: (name: string) => void;
  readonly onThemeChange: (slot: ThemeSlot, id: string) => void;
  readonly onToggleLineNumbers: () => void;
  readonly onPresetChange: (axis: PresetAxis, value: string) => void;
  /** The element the scroll anchor measures; the page owns the shell. */
  readonly containerRef?: RefObject<HTMLElement | null>;
  readonly statusRef?: RefObject<HTMLParagraphElement | null>;
};

export const App = ({
  state,
  display,
  mode,
  pageTheme,
  presets,
  onToggleMode,
  onPageThemeChange,
  onThemeChange,
  onToggleLineNumbers,
  onPresetChange,
  containerRef,
  statusRef,
}: AppProps) => {
  // The page owns the single h1: the title, else the file name.
  const heading = state.title ?? state.fileName;

  return (
    <div className="preview-shell">
      <Bar
        heading={heading}
        fileName={state.title === null || state.fileName === null ? null : state.fileName}
        mode={mode}
        pageTheme={pageTheme}
        display={display}
        presets={presets}
        statusRef={statusRef}
        onToggleMode={onToggleMode}
        onPageThemeChange={onPageThemeChange}
        onThemeChange={onThemeChange}
        onToggleLineNumbers={onToggleLineNumbers}
        onPresetChange={onPresetChange}
      />

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
