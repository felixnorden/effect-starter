import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./app.tsx";
import { connectClient } from "./socket.ts";
import { applyServerMessage, emptyPreviewState } from "./store.ts";
import { useScrollAnchor } from "./scroll.ts";
import { applyTheme, resolveTheme, toggleTheme, type Theme } from "./theme.ts";
// The KaTeX stylesheet ships the math fonts; the app variables must still win.
import "katex/dist/katex.min.css";
import "./styles.css";

const rootElement = document.getElementById("root");
if (rootElement === null) throw new Error("missing #root");

const Live = () => {
  const [state, setState] = useState(emptyPreviewState);
  const [theme, setTheme] = useState<Theme>(() =>
    resolveTheme({
      matchMedia: (query) => window.matchMedia(query),
      storage: window.sessionStorage,
    }),
  );

  useEffect(() => {
    applyTheme(theme, document.documentElement);
  }, [theme]);

  const container = useRef<HTMLElement>(null);
  const beginPatch = useScrollAnchor(container, state.lastSeq);

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
      containerRef={container}
      theme={theme}
      onToggleTheme={() => setTheme(toggleTheme(theme, { storage: window.sessionStorage }))}
    />
  );
};

createRoot(rootElement).render(<Live />);
