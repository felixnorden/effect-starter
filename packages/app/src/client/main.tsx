import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./app.tsx";
import { handleContentClick, installImageFallback, type ControlDeps } from "./controls.ts";
import { readDisplay, toggleLineNumbers, withTheme } from "./display.ts";
import { THEME_MODE_KEY, resolveSessionTheme } from "./session.ts";
import { connectClient } from "./socket.ts";
import { applyServerMessage, emptyPreviewState } from "./store.ts";
import { useCursorPlacement, useScrollAnchor } from "./scroll.ts";
import {
  applyTheme,
  readStoredTheme,
  resolveTheme,
  systemTheme,
  toggleTheme,
  type Theme,
} from "./theme.ts";
// The KaTeX stylesheet ships the math fonts; the app variables must still win.
import "katex/dist/katex.min.css";
import "./styles.css";

const rootElement = document.getElementById("root");
if (rootElement === null) throw new Error("missing #root");

const initialTheme = resolveTheme({
  matchMedia: (query) => window.matchMedia(query),
  storage: window.sessionStorage,
});
applyTheme(initialTheme, document.documentElement);

const Live = () => {
  const [state, setState] = useState(emptyPreviewState);
  const [display, setDisplay] = useState(() => readDisplay({ storage: window.sessionStorage }));
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [ended, setEnded] = useState<string | null>(null);

  const container = useRef<HTMLElement>(null);
  const status = useRef<HTMLParagraphElement>(null);
  const beginPatch = useScrollAnchor(container, state.lastSeq);
  useCursorPlacement(container, state.cursor, state.session, state.lastSeq);

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
    if (state.session === null) return undefined;
    const next = resolveSessionTheme({
      configured: state.session.themeMode,
      stored: readStoredTheme(window.sessionStorage),
      storedMode: window.sessionStorage.getItem(THEME_MODE_KEY),
      system: systemTheme({ matchMedia: (query) => window.matchMedia(query) }),
    });
    applyTheme(next, document.documentElement);
    setTheme(next);
    return undefined;
  }, [state.session?.themeMode]);

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
      containerRef={container}
      statusRef={status}
      theme={theme}
      ended={ended}
      onToggleLineNumbers={() =>
        setDisplay((current) => toggleLineNumbers(current, { storage: window.sessionStorage }))
      }
      onThemeChange={(slot, id) =>
        setDisplay((current) => withTheme(current, slot, id, { storage: window.sessionStorage }))
      }
      onToggleTheme={() => {
        const next = toggleTheme(theme, { storage: window.sessionStorage });
        window.sessionStorage.setItem(THEME_MODE_KEY, state.session?.themeMode ?? "system");
        applyTheme(next, document.documentElement);
        setTheme(next);
      }}
    />
  );
};

createRoot(rootElement).render(<Live />);
