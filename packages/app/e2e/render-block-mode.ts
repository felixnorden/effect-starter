// @effect-diagnostics asyncFunction:off
// @effect-diagnostics strictEffectProvide:off
/**
 * Renders one fixture with the remote policy off and prints the document HTML.
 * Block mode has no lever on the running page, so the spec spawns this helper.
 */
import { CodeHighlighting, defaultRenderOptions, documentToHtml, Renderer } from "@mdv/core";
import { Effect, Layer } from "effect";
import { readFileSync } from "node:fs";

const file = process.argv[2];
if (file === undefined) throw new Error("usage: render-block-mode.ts <fixture>");

const source = readFileSync(file, "utf8");
const document = await Effect.runPromise(
  Effect.gen(function* () {
    const renderer = yield* Renderer;
    return yield* renderer.render(source, { ...defaultRenderOptions, allowRemote: false });
  }).pipe(Effect.provide(Renderer.layer.pipe(Layer.provide(CodeHighlighting.layer)))),
);

process.stdout.write(documentToHtml(document));
