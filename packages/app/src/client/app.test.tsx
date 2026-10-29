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

const BAR_NAMES = [
  "Dark mode",
  "Page theme",
  "Light code theme",
  "Dark code theme",
  "Line numbers",
  "Reading width",
  "Font scale",
] as const;

const DEFAULTS: Omit<AppProps, "state"> = {
  display,
  onThemeChange: () => {},
  onToggleLineNumbers: () => {},
  mode: "light",
  pageTheme: "light",
  presets,
  onToggleMode: () => {},
  onPageThemeChange: () => {},
  onPresetChange: () => {},
};

const TestApp = (props: Partial<Omit<AppProps, "state">> & Pick<AppProps, "state">) => (
  <App {...DEFAULTS} {...props} />
);

/** A button's text, or a select's explicit accessible name. */
const controlNames = (markup: string): readonly string[] => {
  const buttons = [...markup.matchAll(/<button[^>]*>([^<]*)<\/button>/gu)].map(
    (match) => match[1] ?? "",
  );
  const selects = [...markup.matchAll(/<select[^>]*aria-label="([^"]+)"/gu)].map(
    (match) => match[1] ?? "",
  );
  return [...buttons, ...selects];
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

  it("renders two precedence stylesheet links with the default hrefs", () => {
    const markup = renderToStaticMarkup(<TestApp state={emptyPreviewState} />);
    const links = markup.match(/<link[^>]*>/gu) ?? [];

    expect(links).toHaveLength(2);
    expect(markup).toContain('rel="stylesheet"');
    expect(markup).toContain('data-precedence="mdv-code-theme"');
    expect(markup).toContain('data-slot="light"');
    expect(markup).toContain('data-slot="dark"');
    expect(markup).toContain('href="/theme-sheets/github-light-high-contrast.css"');
    expect(markup).toContain('href="/theme-sheets/github-dark-high-contrast.css"');
  });

  it("renders the five selectors and the two code-slot hooks", () => {
    const markup = renderToStaticMarkup(<TestApp state={emptyPreviewState} />);
    const selectors = markup.match(/<select[^>]*>[\s\S]*?<\/select>/gu) ?? [];

    expect(selectors).toHaveLength(5);
    const codeSelectors = selectors.filter((selector) => selector.includes("data-theme-select"));
    expect(codeSelectors).toHaveLength(2);
    expect(codeSelectors[0]).toContain('data-theme-select="light"');
    expect(codeSelectors[1]).toContain('data-theme-select="dark"');
    expect(markup).toContain("Light code");
    expect(markup).toContain("Dark code");

    for (const slot of ["light", "dark"] as const) {
      const selector =
        codeSelectors.find((entry) => entry.includes(`data-theme-select="${slot}"`)) ?? "";
      const ids = [...selector.matchAll(/<option value="([^"]+)"/gu)].map((match) => match[1]);
      expect(ids).toEqual(optionsForMode(slot).map((option) => option.id));
      expect(selector).toContain(`value="${display[slot].id}"`);
    }
  });

  it("renders the bar's seven named controls in four groups, in order", () => {
    const markup = renderToStaticMarkup(
      <TestApp state={stateOf({ title: "Kitchen Sink", fileName: "kitchen-sink.md" })} />,
    );

    expect(controlNames(markup).toSorted()).toEqual([...BAR_NAMES].toSorted());
    expect(markup).toContain('class="preview-identity"');
    expect(markup.match(/role="group"/gu)?.length).toBe(3);

    const order = [
      markup.indexOf("<h1"),
      markup.indexOf("Dark mode"),
      markup.indexOf("Light code theme"),
      markup.indexOf("Reading width"),
      markup.indexOf('aria-live="polite"'),
      markup.indexOf("Font scale"),
    ];
    expect(order[0]).toBeLessThan(order[1] ?? -1);
    expect(order[1]).toBeLessThan(order[2] ?? -1);
    expect(order[2]).toBeLessThan(order[3] ?? -1);
    expect(order[3]).toBeLessThan(order[4] ?? -1);
  });

  it("announces the active mode without renaming itself", () => {
    const light = renderToStaticMarkup(<TestApp state={emptyPreviewState} mode="light" />);
    const dark = renderToStaticMarkup(<TestApp state={emptyPreviewState} mode="dark" />);

    expect(light).toContain("Dark mode");
    expect(dark).toContain("Dark mode");
    expect(light).toMatch(/<button[^>]*aria-pressed="false"[^>]*>Dark mode<\/button>/u);
    expect(dark).toMatch(/<button[^>]*aria-pressed="true"[^>]*>Dark mode<\/button>/u);
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

  it("gives every select a visible label contained in its accessible name", () => {
    const markup = renderToStaticMarkup(<TestApp state={emptyPreviewState} />);
    const pairs = [
      ["Page theme", "Page theme"],
      ["Light code", "Light code theme"],
      ["Dark code", "Dark code theme"],
      ["Width", "Reading width"],
      ["Scale", "Font scale"],
    ] as const;

    for (const [visible, name] of pairs) {
      // WCAG 2.5.3 containment is case-insensitive: "Width" reads inside
      // "Reading width". axe lowercases both sides of the same comparison.
      expect(name.toLowerCase()).toContain(visible.toLowerCase());
      expect(markup).toMatch(new RegExp(`${visible}</label><select[^>]*aria-label="${name}"`, "u"));
    }
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
