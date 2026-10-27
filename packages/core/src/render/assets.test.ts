// @effect-diagnostics asyncFunction:off
// @effect-diagnostics strictEffectProvide:off
import { Effect, Layer, Schema } from "effect";
import type { Element, ElementContent, Properties } from "hast";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  AUTHORED_SOURCE_PROPERTY,
  PLACEHOLDER_MARKER,
  RESOLVED_PATH_PROPERTY,
  classifyImageSource,
  resolveImageSources,
} from "./assets.ts";
import type { DocumentModel } from "./document.ts";
import { CodeHighlighting, type HighlighterPort } from "./highlight.ts";
import { defaultRenderOptions, type RenderOptions } from "./options.ts";
import { RenderStageSchema, Renderer } from "./renderer.ts";
import { documentToHtml } from "./to-html.ts";

const fixtureOf = (name: string): string =>
  readFileSync(new URL(`../../../../fixtures/render-fidelity/${name}.md`, import.meta.url), "utf8");

type PlaceholderContract = {
  readonly marker: { readonly property: string; readonly attribute: string };
  readonly authoredSource: { readonly property: string; readonly attribute: string };
  readonly resolvedPath: { readonly property: string; readonly attribute: string };
  readonly accessibleName: { readonly property: string; readonly attribute: string };
  readonly box: { readonly property: string };
  readonly cases: readonly {
    readonly producer: string;
    readonly source: string;
    readonly resolved: string;
    readonly alt: string;
    readonly width: string;
    readonly height: string;
    readonly expect: { readonly width: string; readonly height: string };
  }[];
};

const contract: PlaceholderContract = JSON.parse(
  readFileSync(new URL("../../../../fixtures/placeholder-cases.json", import.meta.url), "utf8"),
) as PlaceholderContract;

const preWithText = (code: string): Element => ({
  type: "element",
  tagName: "pre",
  properties: { className: ["shiki"] },
  children: [
    { type: "element", tagName: "code", properties: {}, children: [{ type: "text", value: code }] },
  ],
});

const stubPort: HighlighterPort = {
  codeToHast: async (code) => ({ type: "root", children: [preWithText(code)] }),
  getLoadedLanguages: () => ["text"],
  loadLanguage: async () => {},
};

const layer = Renderer.layer.pipe(Layer.provide(CodeHighlighting.layerOf(stubPort)));

const render = (source: string, options: RenderOptions = defaultRenderOptions) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const renderer = yield* Renderer;
      return yield* renderer.render(source, options);
    }).pipe(Effect.provide(layer)),
  );

const elementsOf = (document: DocumentModel, tagName: string): Element[] => {
  const found: Element[] = [];
  const walk = (nodes: readonly ElementContent[]): void => {
    for (const node of nodes) {
      if (node.type !== "element") continue;
      if (node.tagName === tagName) found.push(node);
      walk(node.children);
    }
  };
  for (const block of document.blocks) walk(block.hast);
  return found;
};

const placeholdersOf = (document: DocumentModel): Element[] =>
  elementsOf(document, "span").filter(
    (element) => element.properties[PLACEHOLDER_MARKER] !== undefined,
  );

const textOf = (element: Element): string =>
  element.children.map((child) => (child.type === "text" ? child.value : "")).join("");

const stage = (
  nodes: readonly ElementContent[],
  options: Partial<RenderOptions> = {},
): ElementContent[] => resolveImageSources(nodes, { ...defaultRenderOptions, ...options });

const imageNode = (properties: Properties): Element => ({
  type: "element",
  tagName: "img",
  properties,
  children: [],
});

describe("image classification", () => {
  it("classifies each source form into exactly one outcome", () => {
    const table: readonly {
      readonly source: string;
      readonly options: Partial<RenderOptions>;
      readonly outcome: string;
      readonly reference: string | null;
    }[] = [
      { source: "data:image/png;base64,AAAA", options: {}, outcome: "data", reference: null },
      { source: "images/pixel.png", options: {}, outcome: "relative", reference: null },
      {
        source: "https://example.com/pixel.png",
        options: {},
        outcome: "remote",
        reference: null,
      },
      { source: "//example.com/pixel.png", options: {}, outcome: "remote", reference: null },
      {
        source: "https://example.com/pixel.png",
        options: { allowRemote: false },
        outcome: "placeholder",
        reference: null,
      },
      {
        source: "/tmp/assets/a.png",
        options: { imageRoot: "/tmp/assets" },
        outcome: "rootReference",
        reference: "/image-root/a.png",
      },
      {
        source: "/tmp/other/a.png",
        options: { imageRoot: "/tmp/assets" },
        outcome: "placeholder",
        reference: null,
      },
      {
        source: "/no/such/root/a.png",
        options: { imageRoot: null },
        outcome: "placeholder",
        reference: null,
      },
    ];

    for (const row of table) {
      const classification = classifyImageSource(row.source, {
        ...defaultRenderOptions,
        ...row.options,
      });
      expect({ source: row.source, ...classification }).toEqual({
        source: row.source,
        outcome: row.outcome,
        reference: row.reference,
      });
    }
  });

  it("stamps every image with the source the author wrote", async () => {
    for (const name of [
      "images-data",
      "nested/images-relative",
      "images-remote",
      "images-raw-img",
    ]) {
      const document = await render(fixtureOf(name));
      const stamped = [...elementsOf(document, "img"), ...placeholdersOf(document)];
      expect(stamped.length).toBeGreaterThan(0);
      for (const element of stamped) {
        expect(typeof element.properties[AUTHORED_SOURCE_PROPERTY]).toBe("string");
      }
    }

    const raw = await render(fixtureOf("images-raw-img"));
    const sources = [...elementsOf(raw, "img"), ...placeholdersOf(raw)].map((element) =>
      String(element.properties[AUTHORED_SOURCE_PROPERTY]),
    );
    const sorted = (values: readonly string[]): string[] =>
      values.toSorted((a, b) => a.localeCompare(b));
    expect(sorted(sources)).toEqual(
      sorted(["../../images/pixel.png", "/tmp/assets/pixel.png", "https://example.com/pixel.png"]),
    );
  });

  it("rewrites a source inside the configured root and placeholders one outside it", async () => {
    const inside = await render("![a](/tmp/assets/a.png)", {
      ...defaultRenderOptions,
      imageRoot: "/tmp/assets",
    });
    const outside = await render("![a](/tmp/other/a.png)", {
      ...defaultRenderOptions,
      imageRoot: "/tmp/assets",
    });
    const unset = await render("![a](/tmp/assets/a.png)\n\n![b](/tmp/other/a.png)");

    expect(elementsOf(inside, "img")[0]?.properties.src).toBe("/image-root/a.png");
    expect(placeholdersOf(outside)).toHaveLength(1);
    expect(elementsOf(outside, "img")).toHaveLength(0);
    expect(placeholdersOf(unset)).toHaveLength(2);
  });

  it("turns an unresolvable absolute source into a placeholder with the path", async () => {
    const document = await render(fixtureOf("images-unresolvable"));
    const [placeholder] = placeholdersOf(document);

    expect(placeholdersOf(document)).toHaveLength(2);
    expect(placeholder?.properties.role).toBe("img");
    expect(placeholder?.properties.ariaLabel).toBe("diagram");
    expect(placeholder?.properties[PLACEHOLDER_MARKER]).toBe("");
    expect(placeholder?.properties[AUTHORED_SOURCE_PROPERTY]).toBe("/no/such/root/a.png");
    expect(placeholder?.properties[RESOLVED_PATH_PROPERTY]).toBe("/no/such/root/a.png");
    expect(placeholder === undefined ? null : textOf(placeholder)).toBe("/no/such/root/a.png");
    expect(placeholder?.properties.style).toBe("width:120px;height:80px");
  });

  it("keeps a percentage box verbatim", async () => {
    const document = await render('<img src="/no/such/root/b.png" width="50%" height="auto">');
    const [placeholder] = placeholdersOf(document);

    expect(placeholder?.properties.style).toBe("width:50%;height:auto");
    expect(placeholder?.properties.ariaLabel).toBeUndefined();
  });

  it("blocks a remote source when the policy is off and passes it when on", async () => {
    const blocked = await render(fixtureOf("images-blocked"), {
      ...defaultRenderOptions,
      allowRemote: false,
    });
    const allowed = await render(fixtureOf("images-blocked"));

    expect(elementsOf(blocked, "img")).toHaveLength(0);
    const [placeholder] = placeholdersOf(blocked);
    expect(placeholder === undefined ? null : textOf(placeholder)).toBe(
      "https://example.com/blocked.png",
    );

    const [image] = elementsOf(allowed, "img");
    expect(image?.properties.src).toBe("https://example.com/blocked.png");
    expect(image?.properties[AUTHORED_SOURCE_PROPERTY]).toBe("https://example.com/blocked.png");
  });

  it("passes a data URL through untouched under both policies", async () => {
    const source = fixtureOf("images-data");
    const allowed = await render(source);
    const blocked = await render(source, { ...defaultRenderOptions, allowRemote: false });

    expect(documentToHtml(blocked)).toBe(documentToHtml(allowed));
    expect(elementsOf(blocked, "img")[0]?.properties.src).toBe(
      elementsOf(allowed, "img")[0]?.properties.src,
    );
    // `allowRemote` stays in the salt, so the block hashes differ by design.
    expect(blocked.blocks[1]?.hash).not.toBe(allowed.blocks[1]?.hash);
  });

  it("renders the same picture identically as raw HTML and as Markdown", async () => {
    const markdown = await render("A picture ![pixel](images/pixel.png) inline");
    const raw = await render('A picture <img src="images/pixel.png" alt="pixel"> inline');

    expect(documentToHtml(raw)).toBe(documentToHtml(markdown));
    expect(raw.blocks[0]?.hash).toBe(markdown.blocks[0]?.hash);
  });

  it("gives a placeholder no request-bearing attribute", () => {
    const requestBearing = new Set([
      "src",
      "srcset",
      "href",
      "poster",
      "data",
      "action",
      "srcDoc",
      "formAction",
    ]);
    const declared = new Set([
      contract.marker.property,
      contract.authoredSource.property,
      contract.resolvedPath.property,
      contract.accessibleName.property,
      "role",
      contract.box.property,
    ]);

    for (const example of contract.cases.filter((entry) => entry.producer === "core")) {
      const [placeholder] = stage([
        imageNode({
          src: example.source,
          alt: example.alt,
          width: example.width,
          height: example.height,
        }),
      ]);
      if (placeholder === undefined || placeholder.type !== "element") throw new Error("no node");
      for (const [name, value] of Object.entries(placeholder.properties)) {
        expect(declared.has(name)).toBe(true);
        expect(requestBearing.has(name)).toBe(false);
        expect(String(value).startsWith("http:")).toBe(false);
        expect(String(value).startsWith("//")).toBe(false);
      }
    }
  });

  it("cannot resurrect a source the gate dropped", async () => {
    const document = await render(
      '<img src="javascript:alert(1)">\n\n<img src="data:text/html,x">',
    );
    const html = documentToHtml(document);

    expect(elementsOf(document, "img")).toHaveLength(0);
    expect(placeholdersOf(document)).toHaveLength(0);
    expect(html).not.toContain("data-mdv-source");
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("data:text/html");
  });
});

describe("asset stage failure", () => {
  it("rejects an image source that is not a string", () => {
    const malformed = [imageNode({ src: 42 as unknown as string })];

    expect(() => stage(malformed)).toThrow(/image source is not a string/u);
  });

  it("drops an image the gate emptied and names the stage", () => {
    expect(stage([imageNode({})])).toEqual([]);
    expect(Schema.decodeSync(RenderStageSchema)("assets")).toBe("assets");
  });
});
