import type { BlockId, WireBlock } from "@mdv/core/protocol";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { App } from "./app.tsx";
import { emptyPreviewState, type PreviewState } from "./store.ts";

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
      <App
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
      <App state={stateOf({ fileName: "kitchen-sink.md", title: "Kitchen Sink" })} />,
    );

    expect(markup).toContain("kitchen-sink.md");
    expect(markup).toContain("Kitchen Sink");
  });

  it("renders the banner outside main", () => {
    const markup = renderToStaticMarkup(
      <App
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
      <App state={stateOf({ title: "Kitchen Sink", fileName: "kitchen-sink.md" })} />,
    );
    const heading = /<h1[^>]*>(.*?)<\/h1>/u.exec(markup);

    expect(markup.match(/<h1/gu)?.length).toBe(1);
    expect(heading?.[1]).toBe("Kitchen Sink");
    expect(markup.replace(/<h1[^>]*>.*?<\/h1>/u, "")).toContain("kitchen-sink.md");
  });

  it("uses the file name as the h1 when there is no title", () => {
    const markup = renderToStaticMarkup(<App state={stateOf({ fileName: "kitchen-sink.md" })} />);

    expect(markup.match(/<h1/gu)?.length).toBe(1);
    expect(/<h1[^>]*>(.*?)<\/h1>/u.exec(markup)?.[1]).toBe("kitchen-sink.md");
  });

  it("does not repeat the file name when it is the h1", () => {
    const markup = renderToStaticMarkup(<App state={stateOf({ fileName: "kitchen-sink.md" })} />);

    expect(markup.split("kitchen-sink.md").length).toBe(2);
  });

  it("renders no h1 before ready", () => {
    const markup = renderToStaticMarkup(<App state={emptyPreviewState} />);

    expect(markup).not.toContain("<h1");
  });

  it("keeps the banner inside main", () => {
    const markup = renderToStaticMarkup(
      <App state={stateOf({ banner: { stage: "watch", message: "unreadable" } })} />,
    );
    const main = markup.slice(markup.indexOf("<main"), markup.indexOf("</main>"));

    expect(markup.indexOf('role="alert"')).toBeGreaterThan(markup.indexOf("<main"));
    expect(main).toContain('role="alert"');
  });

  it("renders the file name as text, never as Markdown", () => {
    const markup = renderToStaticMarkup(<App state={stateOf({ fileName: "a_b_<c>.md" })} />);

    expect(markup).toContain("a_b_&lt;c&gt;.md");
    expect(markup).not.toContain("<b");
  });

  it("keeps the last document visible under the banner", () => {
    const markup = renderToStaticMarkup(
      <App
        state={stateOf({
          ...blockState(),
          banner: { stage: "watch", message: "unreadable" },
        })}
      />,
    );

    expect(markup).toContain("Document text");
    expect(markup).toContain("watch: unreadable");
  });
});
