import type { CSSProperties, RefObject } from "react";

import type { Display, ThemeSlot } from "./display.ts";
import type { PageThemeScheme } from "./page-theme.ts";
import { fileNameLineOf, headingOf, layoutStyleOf } from "./session.ts";
import type { SidebarState } from "./sidebar-state.ts";
import type { PreviewState } from "./store.ts";
import type { PresetAxis, Presets } from "./view-presets.ts";

import { BlockList } from "./blocks.tsx";
import { Header } from "./header.tsx";
import { Sidebar } from "./sidebar.tsx";

export type AppProps = {
  readonly state: PreviewState;
  readonly display: Display;
  readonly mode: PageThemeScheme;
  readonly pageTheme: string;
  readonly presets: Presets;
  readonly sidebar: SidebarState;
  /** True once the user has toggled the panel; gates the morph animation. */
  readonly animated?: boolean;
  readonly onToggleSidebar: () => void;
  readonly onToggleMode: () => void;
  readonly onPageThemeChange: (name: string) => void;
  readonly onThemeChange: (slot: ThemeSlot, id: string) => void;
  readonly onToggleLineNumbers: () => void;
  readonly onPresetChange: (axis: PresetAxis, value: string) => void;
  /** The element the scroll anchor measures; the page owns the shell. */
  readonly containerRef?: RefObject<HTMLElement | null>;
  readonly statusRef?: RefObject<HTMLParagraphElement | null>;
  /** Set when the socket closes; the page then names the restart command. */
  readonly ended?: string | null;
};

export const App = ({
  state,
  display,
  mode,
  pageTheme,
  presets,
  sidebar,
  animated = false,
  onToggleSidebar,
  onToggleMode,
  onPageThemeChange,
  onThemeChange,
  onToggleLineNumbers,
  onPresetChange,
  containerRef,
  statusRef,
  ended,
}: AppProps) => {
  // The session names the page; the document's own title is the fallback.
  const heading = headingOf(state.session, state.title, state.fileName);
  const fileLine = fileNameLineOf(state.session, state.title, state.fileName);

  return (
    <div
      className="preview-shell"
      style={layoutStyleOf(state.session) as CSSProperties | undefined}
      data-sidebar={sidebar}
      data-animated={animated}
    >
      <Header heading={heading} fileName={fileLine} statusRef={statusRef} />

      <button
        type="button"
        className="preview-backdrop"
        aria-hidden="true"
        tabIndex={-1}
        onClick={onToggleSidebar}
      />

      <Sidebar
        state={sidebar}
        mode={mode}
        pageTheme={pageTheme}
        display={display}
        presets={presets}
        onToggleSidebar={onToggleSidebar}
        onToggleMode={onToggleMode}
        onPageThemeChange={onPageThemeChange}
        onThemeChange={onThemeChange}
        onToggleLineNumbers={onToggleLineNumbers}
        onPresetChange={onPresetChange}
      />

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
