import type { BlockId, WireBlock } from "@mdv/core/protocol";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { App, type AppProps } from "./app.tsx";
import { defaultDisplay, optionsForMode } from "./display.ts";
import { pageThemesFor } from "./page-theme.ts";
import { emptyPreviewState, type PreviewState } from "./store.ts";
import type { Presets } from "./view-presets.ts";

const display = defaultDisplay();
const presets: Presets = { width: "normal", scale: "normal" };

const PANEL_NAMES = [
  "Dark mode",
  "Page theme",
  "Narrow",
  "Normal",
  "Wide",
  "Small",
  // One per axis: the width join and the scale join each offer a "Normal".
  "Normal",
  "Large",
  "Code theme",
  "Line numbers",
] as const;

/** The header's one control, at the top of the panel in both states. */
const TOGGLE_NAME = "Settings";

const RAIL_NAMES = [TOGGLE_NAME, "Dark mode", "Line numbers"] as const;

const DEFAULTS: Omit<AppProps, "state"> = {
  display,
  onThemeChange: () => {},
  onToggleLineNumbers: () => {},
  mode: "light",
  pageTheme: "light",
  presets,
  sidebar: "open",
  onToggleSidebar: () => {},
  onToggleMode: () => {},
  onPageThemeChange: () => {},
  onPresetChange: () => {},
};

const TestApp = (props: Partial<Omit<AppProps, "state">> & Pick<AppProps, "state">) => (
  <App {...DEFAULTS} {...props} />
);

/** A button's aria-label or its text, and a select's explicit accessible name. */
const controlNames = (markup: string): readonly string[] => {
  const buttons = [...markup.matchAll(/<button[^>]*>[\s\S]*?<\/button>/gu)].map((match) => {
    const label = /aria-label="([^"]+)"/u.exec(match[0])?.[1];
    return label ?? match[0].replace(/^<button[^>]*>|<\/button>$/gu, "");
  });
  const selects = [...markup.matchAll(/<select[^>]*aria-label="([^"]+)"/gu)].map(
    (match) => match[1] ?? "",
  );
  return [...buttons, ...selects];
};

/** The panel's own markup, from its id to its closing tag. */
const panelOf = (markup: string): string => {
  const start = markup.indexOf('id="preview-panel"');
  return start === -1 ? "" : markup.slice(start, markup.indexOf("</aside>", start));
};

const blockOf = (id: string, text: string): WireBlock => ({
  id: id as BlockId,
  hash: id,
  kind: "paragraph",
  range: { startLine: 1, endLine: 1 },
  hast: [
    {
      type: "element",
      tagName: "p",
      properties: {},
      children: [{ type: "text", value: text }],
    },
  ],
});

const stateOf = (overrides: Partial<PreviewState>): PreviewState => ({
  ...emptyPreviewState,
  ...overrides,
});

const blockState = (): Pick<PreviewState, "order" | "blocks"> => {
  const block = blockOf("a", "Document text");
  return { order: [block.id], blocks: new Map([[block.id, block]]) };
};

describe("App", () => {
  it("renders the title and the error banner together", () => {
    const markup = renderToStaticMarkup(
      <TestApp
        state={stateOf({
          title: "Kitchen Sink",
          banner: { stage: "render", message: "boom" },
        })}
      />,
    );

    expect(markup).toContain("Kitchen Sink");
    expect(markup).toContain("render: boom");
  });

  it("renders the file name from ready beside the title", () => {
    const markup = renderToStaticMarkup(
      <TestApp state={stateOf({ fileName: "kitchen-sink.md", title: "Kitchen Sink" })} />,
    );

    expect(markup).toContain("kitchen-sink.md");
    expect(markup).toContain("Kitchen Sink");
  });

  it("renders the banner outside main", () => {
    const markup = renderToStaticMarkup(
      <TestApp
        state={stateOf({
          ...blockState(),
          title: "Kitchen Sink",
          fileName: "kitchen-sink.md",
        })}
      />,
    );

    expect(markup.indexOf("<header")).toBeLessThan(markup.indexOf("<main"));
    expect(markup.slice(markup.indexOf("<main"))).not.toContain("<header");
  });

  it("uses the title as the only h1", () => {
    const markup = renderToStaticMarkup(
      <TestApp state={stateOf({ title: "Kitchen Sink", fileName: "kitchen-sink.md" })} />,
    );
    const heading = /<h1[^>]*>(.*?)<\/h1>/u.exec(markup);

    expect(markup.match(/<h1/gu)?.length).toBe(1);
    expect(heading?.[1]).toBe("Kitchen Sink");
    expect(markup.replace(/<h1[^>]*>.*?<\/h1>/u, "")).toContain("kitchen-sink.md");
  });

  it("uses the file name as the h1 when there is no title", () => {
    const markup = renderToStaticMarkup(
      <TestApp state={stateOf({ fileName: "kitchen-sink.md" })} />,
    );

    expect(markup.match(/<h1/gu)?.length).toBe(1);
    expect(/<h1[^>]*>(.*?)<\/h1>/u.exec(markup)?.[1]).toBe("kitchen-sink.md");
  });

  it("does not repeat the file name when it is the h1", () => {
    const markup = renderToStaticMarkup(
      <TestApp state={stateOf({ fileName: "kitchen-sink.md" })} />,
    );

    expect(markup.split("kitchen-sink.md").length).toBe(2);
  });

  it("renders no h1 before ready", () => {
    const markup = renderToStaticMarkup(<TestApp state={emptyPreviewState} />);

    expect(markup).not.toContain("<h1");
  });

  it("keeps the banner inside main", () => {
    const markup = renderToStaticMarkup(
      <TestApp state={stateOf({ banner: { stage: "watch", message: "unreadable" } })} />,
    );
    const main = markup.slice(markup.indexOf("<main"), markup.indexOf("</main>"));

    expect(markup.indexOf('role="alert"')).toBeGreaterThan(markup.indexOf("<main"));
    expect(main).toContain('role="alert"');
  });

  it("renders the file name as text, never as Markdown", () => {
    const markup = renderToStaticMarkup(<TestApp state={stateOf({ fileName: "a_b_<c>.md" })} />);

    expect(markup).toContain("a_b_&lt;c&gt;.md");
    expect(markup).not.toContain("<b>");
  });

  it("leaves the code-theme sheets to the head and renders no link", () => {
    const markup = renderToStaticMarkup(<TestApp state={emptyPreviewState} />);

    // React's hoisted links keep every href they have seen; theme-sheets.ts owns them.
    expect(markup).not.toContain("<link");
    expect(markup).toContain('data-animated="false"');
  });

  it("keeps two selects: page theme in the mode row, and the active code theme", () => {
    const light = renderToStaticMarkup(<TestApp state={emptyPreviewState} />);
    const dark = renderToStaticMarkup(<TestApp state={emptyPreviewState} mode="dark" />);

    for (const [markup, slot] of [
      [light, "light"],
      [dark, "dark"],
    ] as const) {
      const selectors = markup.match(/<select[^>]*>[\s\S]*?<\/select>/gu) ?? [];
      expect(selectors).toHaveLength(2);
      const [code] = selectors.filter((selector) => selector.includes("data-theme-select"));
      expect(code, `${slot} code theme select`).toContain(`data-theme-select="${slot}"`);
      expect(code).toContain('aria-label="Code theme"');
      const ids = [...(code ?? "").matchAll(/<option value="([^"]+)"/gu)].map((m) => m[1]);
      expect(ids).toEqual(optionsForMode(slot).map((option) => option.id));
      expect(code).toContain(`value="${display[slot].id}"`);
    }

    // The mode button and the page theme select share one row.
    expect(light).toMatch(
      /<div class="preview-row"><button[^>]*aria-label="Dark mode"[\s\S]*?<select[^>]*data-page-theme-select="light"[^>]*>/u,
    );
    // No visible Page theme label: the row itself is the context.
    expect(light).not.toContain(">Page theme</label>");
  });

  it("renders the panel's named controls in two titled sections, in order", () => {
    const markup = renderToStaticMarkup(
      <TestApp state={stateOf({ title: "Kitchen Sink", fileName: "kitchen-sink.md" })} />,
    );

    const panel = panelOf(markup);
    expect(controlNames(panel).toSorted()).toEqual([...PANEL_NAMES, TOGGLE_NAME].toSorted());

    const groups = [
      ...panel.matchAll(/<section class="preview-group"[^>]*>([\s\S]*?)<\/section>/gu),
    ];
    expect(groups).toHaveLength(2);
    expect(groups[0]?.[1]).toContain(">Appearance</h2>");
    expect(groups[1]?.[1]).toContain(">Reading</h2>");

    // One area per section, in the order the panel paints them.
    const order = [
      panel.indexOf(">Appearance</h2>"),
      panel.indexOf('aria-label="Page theme"'),
      panel.indexOf(">Code theme</label>"),
      panel.indexOf('aria-label="Line numbers"'),
      panel.indexOf(">Reading</h2>"),
      panel.indexOf(">Reading width</span>"),
      panel.indexOf(">Font scale</span>"),
    ];
    for (const [index, at] of order.entries()) {
      expect(at, `control ${index} is present`).toBeGreaterThanOrEqual(0);
    }
    expect([...order].toSorted((left, right) => left - right)).toEqual(order);
  });

  it("shows line numbers as a hash button with a tooltip, not as text", () => {
    const markup = renderToStaticMarkup(<TestApp state={emptyPreviewState} />);

    expect(markup).toMatch(/<button[^>]*aria-label="Line numbers"[^>]*title="Line numbers"/u);
    expect(markup).not.toContain(">Line numbers<");
    expect(markup).toMatch(
      /aria-label="Line numbers"[^>]*>[\s\S]*?<span class="preview-hash"[^>]*>#<\/span>/u,
    );
  });

  it("puts the header first, then the panel, then the document", () => {
    const markup = renderToStaticMarkup(<TestApp state={emptyPreviewState} />);
    const header = markup.indexOf("<header");
    const panel = markup.indexOf('id="preview-panel"');
    const main = markup.indexOf("<main");
    const headerMarkup = markup.slice(header, markup.indexOf("</header>"));

    expect(header).toBeGreaterThanOrEqual(0);
    expect(header).toBeLessThan(panel);
    expect(panel).toBeLessThan(main);
    // The panel is a sibling of main, never inside the document's landmark.
    expect(markup.slice(main)).not.toContain('id="preview-panel"');
    expect(markup).toContain('aria-live="polite"');
    expect(markup.indexOf('aria-live="polite"')).toBeLessThan(panel);
    // The header holds no control: the toggle travels with the panel.
    expect(headerMarkup).not.toContain("<button");
    expect(panelOf(markup)).toContain(`aria-label="${TOGGLE_NAME}"`);
  });

  it("collapses to a rail that keeps the toggle and the two switches", () => {
    const open = renderToStaticMarkup(<TestApp state={emptyPreviewState} />);
    const rail = renderToStaticMarkup(<TestApp state={emptyPreviewState} sidebar="rail" />);

    expect(panelOf(open).match(/<select/gu)).toHaveLength(2);
    expect(panelOf(rail).match(/<select/gu)).toBeNull();
    expect(controlNames(panelOf(rail)).toSorted()).toEqual([...RAIL_NAMES].toSorted());
    expect(rail).toMatch(/<aside[^>]*data-state="rail"/u);
    expect(rail).not.toContain("preview-group-title");
    expect(rail).not.toMatch(/>Dark mode</u);
  });

  it("wires the Settings toggle to the panel's state", () => {
    const open = renderToStaticMarkup(<TestApp state={emptyPreviewState} />);
    const rail = renderToStaticMarkup(<TestApp state={emptyPreviewState} sidebar="rail" />);

    expect(open).toMatch(
      /<button[^>]*aria-label="Settings"[^>]*aria-expanded="true"[^>]*aria-controls="preview-panel"/u,
    );
    expect(rail).toMatch(
      /<button[^>]*aria-label="Settings"[^>]*aria-expanded="false"[^>]*aria-controls="preview-panel"/u,
    );
  });

  it("toggles the mode from a sun/moon swap that announces its state", () => {
    const light = renderToStaticMarkup(<TestApp state={emptyPreviewState} mode="light" />);
    const dark = renderToStaticMarkup(<TestApp state={emptyPreviewState} mode="dark" />);

    expect(light).toMatch(/<button[^>]*aria-label="Dark mode"[^>]*aria-pressed="false"/u);
    expect(dark).toMatch(/<button[^>]*aria-label="Dark mode"[^>]*aria-pressed="true"/u);

    // The icon carries the mode; the name carries the action.
    expect(light).not.toContain(">Dark mode</span>");
    expect(light).toContain('class="swap swap-rotate"');
    expect(dark).toContain('class="swap swap-rotate swap-active"');
    expect(light).toContain('class="swap-off size-4 fill-current"');
    expect(light).toContain('class="swap-on size-4 fill-current"');
  });

  it("offers the page-theme picker only the active slot's scheme", () => {
    const markup = renderToStaticMarkup(
      <TestApp state={emptyPreviewState} mode="dark" pageTheme="dim" />,
    );
    const select = /<select[^>]*data-page-theme-select="dark"[^>]*>[\s\S]*?<\/select>/u.exec(
      markup,
    )?.[0];

    expect(select).toBeDefined();
    const labels = [...(select ?? "").matchAll(/<option[^>]*>([^<]+)<\/option>/gu)].map(
      (match) => match[1],
    );
    expect(labels).toEqual(pageThemesFor("dark").map((theme) => theme.label));
    expect(select).toContain('value="dim"');
  });

  it("labels the code theme visibly and names the page theme without a label", () => {
    const markup = renderToStaticMarkup(<TestApp state={emptyPreviewState} />);

    expect(markup).toMatch(/Code theme<\/label><select[^>]*aria-label="Code theme"/u);
    // The mode row gives the page theme its context; a second label would repeat it.
    expect(markup).toMatch(/<select[^>]*aria-label="Page theme"/u);
    expect(markup).not.toContain(">Page theme</label>");
  });

  it("offers width and scale as three-way joins instead of dropdowns", () => {
    const markup = renderToStaticMarkup(<TestApp state={emptyPreviewState} />);
    const join = (axis: string): string =>
      new RegExp(`data-preset-axis="${axis}">([\\s\\S]*?)</div>`, "u").exec(markup)?.[1] ?? "";
    const width = join("width");
    const scale = join("scale");

    expect(markup).toMatch(/<div class="join w-full" role="group" aria-labelledby="[^"]+"/u);
    expect(markup).toContain(">Reading width</span>");
    expect(markup).toContain(">Font scale</span>");

    for (const [axis, names] of [
      ["width", ["Narrow", "Normal", "Wide"]],
      ["scale", ["Small", "Normal", "Large"]],
    ] as const) {
      const group = axis === "width" ? width : scale;
      expect(group.match(/<button/gu), `${axis} keeps three values visible`).toHaveLength(3);
      expect(group).not.toContain("<select");
      for (const name of names) expect(group).toContain(`aria-label="${name}"`);
    }

    // The stored value is the only pressed segment on its axis.
    expect(width).toMatch(/aria-label="Normal"[^>]*aria-pressed="true"/u);
    expect(width).toMatch(/aria-label="Narrow"[^>]*aria-pressed="false"/u);
    expect(width).toMatch(/aria-label="Wide"[^>]*aria-pressed="false"/u);
    expect(scale.match(/aria-pressed="true"/gu)).toHaveLength(1);
  });

  it("hosts exactly one polite live region and keeps the banner an alert", () => {
    const markup = renderToStaticMarkup(
      <TestApp
        state={stateOf({
          ...blockState(),
          banner: { stage: "render", message: "boom" },
        })}
      />,
    );

    expect(markup.match(/aria-live=/gu)?.length).toBe(1);
    expect(markup).toContain('aria-live="polite"');
    expect(markup).toContain('role="alert"');
  });

  it("renders the line-number toggle and the container attribute", () => {
    const off = renderToStaticMarkup(<TestApp state={emptyPreviewState} />);
    expect(off).toContain('aria-pressed="false"');
    expect(off).toContain("Line numbers");
    expect(off).not.toContain("data-line-numbers=");

    const on = renderToStaticMarkup(
      <TestApp state={emptyPreviewState} display={{ ...display, lineNumbers: true }} />,
    );
    expect(on).toContain('aria-pressed="true"');
    expect(on).toContain('data-line-numbers="on"');
  });

  it("the ended state names the cause and the restart command", () => {
    const markup = renderToStaticMarkup(
      <TestApp state={emptyPreviewState} ended="the server closed the connection" />,
    );

    expect(markup).toContain("the server closed the connection");
    expect(markup).toContain(":MarkdownPreview");
    expect(markup).toContain('role="alert"');
  });

  it("keeps the last document visible under the banner", () => {
    const markup = renderToStaticMarkup(
      <TestApp
        state={stateOf({
          ...blockState(),
          banner: { stage: "watch", message: "unreadable" },
        })}
      />,
    );

    expect(markup).toContain("Document text");
    expect(markup).toContain("watch: unreadable");
  });

  const sessionState = (overrides: Partial<PreviewState["session"]> = {}): PreviewState =>
    stateOf({
      session: {
        _tag: "session",
        fileName: "notes.md",
        title: "Notes",
        showFileName: true,
        width: "900px",
        fontSize: "16px",
        markdownCss: null,
        codeCss: null,
        scrollMode: "middle",
        smoothScroll: true,
        themeMode: "system",
        ...overrides,
      },
    });

  it("hides the file-name line and keeps the heading", () => {
    const shown = renderToStaticMarkup(<TestApp state={sessionState()} />);
    const hidden = renderToStaticMarkup(<TestApp state={sessionState({ showFileName: false })} />);

    expect(shown).toContain('class="preview-file-name"');
    expect(shown).toContain("notes.md");
    expect(hidden).not.toContain('class="preview-file-name"');
    expect(hidden).toContain('class="preview-title"');
    expect(hidden).toContain("Notes");
  });

  it("applies width and font size as CSS custom properties", () => {
    const markup = renderToStaticMarkup(
      <TestApp state={sessionState({ width: "1200px", fontSize: "18px" })} />,
    );

    expect(markup).toContain("--preview-width:1200px");
    expect(markup).toContain("--preview-font-size:18px");
  });

  it("links the configured sheets after the theme sheets, code last", () => {
    const markup = renderToStaticMarkup(
      <TestApp
        state={sessionState({
          markdownCss: "/stylesheet/markdown/aaaaaaaaaaaaaaaa",
          codeCss: "/stylesheet/code/bbbbbbbbbbbbbbbb",
        })}
      />,
    );

    const order = ["light", "dark", "markdown", "code"].map((slot) =>
      markup.indexOf(`data-slot="${slot}"`),
    );
    expect(order.every((index) => index >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((left, right) => left - right));
  });
});
