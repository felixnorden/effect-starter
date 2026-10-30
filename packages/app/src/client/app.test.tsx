import type { BlockId, WireBlock } from "@mdv/core/protocol";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { App, type AppProps } from "./app.tsx";
import { defaultDisplay, optionsForMode } from "./display.ts";
import { emptyPreviewState, type PreviewState } from "./store.ts";

const display = defaultDisplay();
const TestApp = (props: Omit<AppProps, "display" | "onThemeChange" | "onToggleLineNumbers">) => (
  <App {...props} display={display} onThemeChange={() => {}} onToggleLineNumbers={() => {}} />
);

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

  it("renders both selectors with their own mode's options and the resolved ids", () => {
    const markup = renderToStaticMarkup(<TestApp state={emptyPreviewState} />);
    const selectors = markup.match(/<select[^>]*>[\s\S]*?<\/select>/gu) ?? [];

    expect(selectors).toHaveLength(2);
    expect(selectors[0]).toContain('data-theme-select="light"');
    expect(selectors[1]).toContain('data-theme-select="dark"');
    expect(markup).toContain("Light theme");
    expect(markup).toContain("Dark theme");

    for (const slot of ["light", "dark"] as const) {
      const selector =
        selectors.find((entry) => entry.includes(`data-theme-select="${slot}"`)) ?? "";
      const ids = [...selector.matchAll(/<option value="([^"]+)"/gu)].map((match) => match[1]);
      expect(ids).toEqual(optionsForMode(slot).map((option) => option.id));
      expect(selector).toContain(`value="${display[slot].id}"`);
    }
  });

  it("renders the line-number toggle and the container attribute", () => {
    const off = renderToStaticMarkup(<TestApp state={emptyPreviewState} />);
    expect(off).toContain('aria-pressed="false"');
    expect(off).toContain("Line numbers");
    expect(off).not.toContain("data-line-numbers=");

    const on = renderToStaticMarkup(
      <App
        state={emptyPreviewState}
        display={{ ...display, lineNumbers: true }}
        onThemeChange={() => {}}
        onToggleLineNumbers={() => {}}
      />,
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
