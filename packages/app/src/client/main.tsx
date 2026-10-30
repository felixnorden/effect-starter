import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./app.tsx";
import { applyView, type View } from "./axes.ts";
import { bootView } from "./boot.ts";
import { handleContentClick, installImageFallback, type ControlDeps } from "./controls.ts";
import { readDisplay, toggleLineNumbers, withTheme } from "./display.ts";
import {
  pageThemeOf,
  readStoredColorMode,
  setPageTheme,
  systemColorMode,
  toggleColorMode,
} from "./page-theme.ts";
import { THEME_MODE_KEY, resolveSessionTheme, sheetLinks } from "./session.ts";
import { readSidebarState, toggleSidebarState, type SidebarState } from "./sidebar-state.ts";
import { connectClient } from "./socket.ts";
import { applyServerMessage, emptyPreviewState } from "./store.ts";
import { syncThemeSheets } from "./theme-sheets.ts";
import { useCursorPlacement, useScrollAnchor } from "./scroll.ts";
import { setPreset } from "./view-presets.ts";
// The framework layers sit under the app rules; the app variables must still win.
import "./daisyui.css";
// The KaTeX stylesheet ships the math fonts; the app variables must still win.
import "katex/dist/katex.min.css";
import "./styles.css";

const rootElement = document.getElementById("root");
if (rootElement === null) throw new Error("missing #root");

// The head snippet already painted these attributes; boot resolves the same
// values for React state and stays the source of truth.
const booted = bootView({
  matchMedia: (query) => window.matchMedia(query),
  storage: window.sessionStorage,
  display: readDisplay({ storage: window.sessionStorage }),
  root: document.documentElement,
});

const storage = (): Storage => window.sessionStorage;

const matchMedia = (query: string): { readonly matches: boolean } => window.matchMedia(query);

const Live = () => {
  const [state, setState] = useState(emptyPreviewState);
  const [display, setDisplay] = useState(() => booted.display);
  const [slots, setSlots] = useState(() => booted.slots);
  const [view, setView] = useState<View>(() => booted.view);
  const [sidebar, setSidebar] = useState<SidebarState>(() =>
    // The panel floats over the page, so the rail is the resting state.
    readSidebarState({ storage: storage(), defaultState: "rail" }),
  );
  // Motion starts with the first toggle, not with the first paint.
  const [animated, setAnimated] = useState(false);
  const [ended, setEnded] = useState<string | null>(null);

  const container = useRef<HTMLElement>(null);
  const status = useRef<HTMLParagraphElement>(null);
  const beginPatch = useScrollAnchor(container, state.lastSeq);
  useCursorPlacement(container, state.cursor, state.session, state.lastSeq);

  const toggleSidebar = (): void => {
    setAnimated(true);
    const next = toggleSidebarState(sidebar, { storage: storage() });
    setSidebar(next);
  };

  // The view is the one source of the four root attributes.
  useEffect(() => {
    applyView(view, document.documentElement);
  }, [view]);

  // The head owns the stylesheet links; React must not re-render them.
  useEffect(() => {
    syncThemeSheets(document, sheetLinks(display, state.session));
  }, [display, state.session]);

  // The member's configured mode wins; a manual toggle is remembered under it.
  useEffect(() => {
    if (state.session === null) return;
    const colorMode = resolveSessionTheme({
      configured: state.session.themeMode,
      stored: readStoredColorMode({ storage: storage() }),
      storedMode: storage().getItem(THEME_MODE_KEY),
      system: systemColorMode({ matchMedia }),
    });
    setView((current) =>
      current.colorMode === colorMode
        ? current
        : { ...current, colorMode, pageTheme: pageThemeOf(slots, colorMode) },
    );
  }, [state.session, slots]);

  // Escape closes the panel, except while a native form control owns the key.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape" || sidebar !== "open" || event.defaultPrevented) return;
      const target = event.target;
      if (target instanceof HTMLElement && target.closest("select, input, textarea") !== null) {
        return;
      }
      setAnimated(true);
      const next = toggleSidebarState(sidebar, { storage: storage() });
      setSidebar(next);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [sidebar]);

  useEffect(() => {
    const element = container.current;
    if (element === null) return undefined;

    const deps: ControlDeps = {
      clipboard: navigator.clipboard,
      location: window.location,
      status: status.current ?? { textContent: null },
      timers: {
        setTimeout: (callback, ms) => window.setTimeout(callback, ms),
        clearTimeout: (handle) => window.clearTimeout(handle as number),
      },
    };
    const removeFallback = installImageFallback(element);
    const onClick = (event: MouseEvent): void => handleContentClick(event, deps);
    element.addEventListener("click", onClick);

    return () => {
      removeFallback();
      element.removeEventListener("click", onClick);
    };
  }, []);

  useEffect(() => {
    const client = connectClient({
      onClose: () => setEnded("the server closed the connection"),
      onMessage: (message) => {
        setEnded(null);
        // A snapshot rebuilds everything, so only a patch has a usable anchor.
        if (message._tag === "patch") beginPatch();
        setState((current) => applyServerMessage(current, message));
      },
    });
    return () => client.close();
  }, [beginPatch]);

  return (
    <App
      state={state}
      display={display}
      sidebar={sidebar}
      animated={animated}
      onToggleSidebar={toggleSidebar}
      containerRef={container}
      statusRef={status}
      ended={ended}
      mode={view.colorMode}
      pageTheme={view.pageTheme}
      presets={{ width: view.width, scale: view.scale }}
      onToggleLineNumbers={() =>
        setDisplay((current) => toggleLineNumbers(current, { storage: storage() }))
      }
      onThemeChange={(slot, id) =>
        setDisplay((current) => withTheme(current, slot, id, { storage: storage() }))
      }
      onToggleMode={() => {
        const colorMode = toggleColorMode(view.colorMode, { storage: storage() });
        storage().setItem(THEME_MODE_KEY, state.session?.themeMode ?? "system");
        setView({ ...view, colorMode, pageTheme: pageThemeOf(slots, colorMode) });
      }}
      onPageThemeChange={(name) => {
        const next = setPageTheme(slots, view.colorMode, name, { storage: storage() });
        if (next === slots) return;
        setSlots(next);
        setView({ ...view, pageTheme: pageThemeOf(next, view.colorMode) });
      }}
      onPresetChange={(axis, value) => {
        const next = setPreset({ width: view.width, scale: view.scale }, axis, value, {
          storage: storage(),
        });
        setView({ ...view, width: next.width, scale: next.scale });
      }}
    />
  );
};

createRoot(rootElement).render(<Live />);
