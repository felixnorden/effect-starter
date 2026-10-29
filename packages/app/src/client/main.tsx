import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./app.tsx";
import { applyView, type View } from "./axes.ts";
import { bootView } from "./boot.ts";
import { handleContentClick, installImageFallback, type ControlDeps } from "./controls.ts";
import { readDisplay, toggleLineNumbers, withTheme } from "./display.ts";
import { pageThemeOf, toggleColorMode } from "./page-theme.ts";
import { connectClient } from "./socket.ts";
import { applyServerMessage, emptyPreviewState } from "./store.ts";
import { useScrollAnchor } from "./scroll.ts";
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

const Live = () => {
  const [state, setState] = useState(emptyPreviewState);
  const [display, setDisplay] = useState(() => booted.display);
  const [view, setView] = useState<View>(() => booted.view);

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

  const apply = (next: View): void => {
    applyView(next, document.documentElement);
    setView(next);
  };

  return (
    <App
      state={state}
      display={display}
      containerRef={container}
      statusRef={status}
      mode={view.colorMode}
      onToggleLineNumbers={() =>
        setDisplay((current) => toggleLineNumbers(current, { storage: storage() }))
      }
      onThemeChange={(slot, id) =>
        setDisplay((current) => withTheme(current, slot, id, { storage: storage() }))
      }
      onToggleMode={() => {
        const colorMode = toggleColorMode(view.colorMode, { storage: storage() });
        apply({ ...view, colorMode, pageTheme: pageThemeOf(booted.slots, colorMode) });
      }}
    />
  );
};

createRoot(rootElement).render(<Live />);
