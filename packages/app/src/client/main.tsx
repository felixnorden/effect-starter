import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./app.tsx";
import { handleContentClick, installImageFallback, type ControlDeps } from "./controls.ts";
import { readDisplay, toggleLineNumbers, withTheme } from "./display.ts";
import { connectClient } from "./socket.ts";
import { applyServerMessage, emptyPreviewState } from "./store.ts";
import { useScrollAnchor } from "./scroll.ts";
import { applyTheme, resolveTheme, toggleTheme, type Theme } from "./theme.ts";
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

  const container = useRef<HTMLElement>(null);
  const status = useRef<HTMLParagraphElement>(null);
  const beginPatch = useScrollAnchor(container, state.lastSeq);

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
      onMessage: (message) => {
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
      onToggleLineNumbers={() =>
        setDisplay((current) => toggleLineNumbers(current, { storage: window.sessionStorage }))
      }
      onThemeChange={(slot, id) =>
        setDisplay((current) => withTheme(current, slot, id, { storage: window.sessionStorage }))
      }
      onToggleTheme={() => {
        const next = toggleTheme(theme, { storage: window.sessionStorage });
        applyTheme(next, document.documentElement);
        setTheme(next);
      }}
    />
  );
};

createRoot(rootElement).render(<Live />);
