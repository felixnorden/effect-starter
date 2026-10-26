// @effect-diagnostics asyncFunction:off
// @effect-diagnostics strictEffectProvide:off
import { Effect, Layer } from "effect";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import type { DocumentModel } from "./document.ts";
import { CodeHighlighting } from "./highlight.ts";
import { defaultRenderOptions } from "./options.ts";
import { Renderer } from "./renderer.ts";
import { documentToHtml } from "./to-html.ts";

const FIXTURE_NAMES = ["math", "toc", "extras", "heading-structure"] as const;

const fixtureOf = (name: string): string =>
  readFileSync(new URL(`../../../../fixtures/render-fidelity/${name}.md`, import.meta.url), "utf8");

const layer = Renderer.layer.pipe(Layer.provide(CodeHighlighting.layer));

const render = (source: string) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const renderer = yield* Renderer;
      return yield* renderer.render(source, defaultRenderOptions);
    }).pipe(Effect.provide(layer)),
  );

/** Kinds, ranges, and hashes together, without duplicating the HAST goldens. */
const modelOf = (document: DocumentModel) => ({
  title: document.title,
  optionsHash: document.optionsHash,
  blocks: document.blocks.map((block) => ({
    kind: block.kind,
    range: block.range,
    hash: block.hash,
  })),
});

describe("renderer fidelity goldens", () => {
  for (const name of FIXTURE_NAMES) {
    it(`pins the ${name} fixture`, async () => {
      const document = await render(fixtureOf(name));

      await expect(documentToHtml(document)).toMatchFileSnapshot(
        `__snapshots__/render-fidelity-${name}.html`,
      );
    });
  }

  it("pins the four block models together", async () => {
    const documents = await Promise.all(FIXTURE_NAMES.map((name) => render(fixtureOf(name))));

    expect(documents.map(modelOf)).toMatchSnapshot();
  });
});
