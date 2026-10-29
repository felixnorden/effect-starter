// @effect-diagnostics schemaNumber:off
import { Context, Effect, Layer, Schema } from "effect";
import type { ElementContent } from "hast";

import { collectBlocks, createMarkdownIt } from "./blocks.ts";
import type { Block, DocumentModel } from "./document.ts";
import { resolveImageSources } from "./assets.ts";
import { readFrontMatter } from "./front-matter.ts";
import { hashBlock } from "./hash.ts";
import { CodeHighlighting } from "./highlight.ts";
import { optionsHash, type RenderOptions } from "./options.ts";
import { sanitizeFragment } from "./raw-html.ts";

export const RenderStageSchema = Schema.Literals([
  "frontMatter",
  "parse",
  "inline",
  "highlight",
  "assemble",
  "assets",
  "hash",
]);

export class RenderError extends Schema.TaggedError<
  RenderError,
  { readonly brand: unique symbol }
>()("RenderError", {
  stage: RenderStageSchema,
  line: Schema.Number,
  message: Schema.String,
}) {}

const describeCause = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

/**
 * The fixed stage order: front matter → parse → inline/raw HTML → highlight →
 * assemble → hash. Later stages depend on it, so tests assert the stage and the
 * line.
 */
export class Renderer extends Context.Service<
  Renderer,
  {
    readonly render: (
      source: string,
      options: RenderOptions,
    ) => Effect.Effect<DocumentModel, RenderError>;
  }
>()("@mdv/core/Renderer") {
  static readonly layer: Layer.Layer<Renderer, never, CodeHighlighting> = Layer.effect(
    Renderer,
    Effect.gen(function* () {
      const highlighting = yield* CodeHighlighting;

      const render = Effect.fn("Renderer.render")(function* (
        source: string,
        options: RenderOptions,
      ) {
        const salt = optionsHash(options);
        const markdownIt = createMarkdownIt(options);
        const frontMatter = readFrontMatter(source);
        const body = frontMatter?.body ?? source;

        const skeletons = yield* Effect.try({
          try: () => collectBlocks(markdownIt, body, options),
          catch: (cause) =>
            new RenderError({
              stage: "parse",
              line: 1,
              message: describeCause(cause),
            }),
        });

        const blocks: Block[] = [];

        const languages = [
          ...new Set(
            skeletons.flatMap((skeleton) => (skeleton.kind === "code" ? [skeleton.lang] : [])),
          ),
        ];
        if (languages.length > 0) {
          // Best effort: a failed preload must not move the error line. The
          // per-block highlight retries and reports the exact line.
          yield* highlighting.preload(languages).pipe(Effect.ignore);
        }

        if (frontMatter !== null) {
          blocks.push(frontMatterBlock(frontMatter.range, salt));
        }

        for (const skeleton of skeletons) {
          if (skeleton.kind === "code") {
            const pre = yield* highlighting
              .highlight({
                code: skeleton.code,
                lang: skeleton.lang,
              })
              .pipe(
                Effect.mapError(
                  (error) =>
                    new RenderError({
                      stage: "highlight",
                      line: skeleton.range.startLine,
                      message: error.message,
                    }),
                ),
              );
            blocks.push({
              kind: "code",
              range: skeleton.range,
              hash: hashBlock([pre], salt),
              hast: [pre],
            });
            continue;
          }

          if (skeleton.kind === "html") {
            const hast = yield* Effect.try({
              try: () => sanitizeFragment(skeleton.fragment),
              catch: (cause) =>
                new RenderError({
                  stage: "assemble",
                  line: skeleton.range.startLine,
                  message: describeCause(cause),
                }),
            });
            const resolved = yield* resolveAssets(hast, skeleton.range.startLine, options);
            blocks.push({
              kind: "html",
              range: skeleton.range,
              hash: hashBlock(resolved, salt),
              hast: resolved,
            });
            continue;
          }

          const resolved = yield* resolveAssets(skeleton.hast, skeleton.range.startLine, options);
          blocks.push({
            kind: skeleton.kind,
            range: skeleton.range,
            hash: hashBlock(resolved, salt),
            hast: resolved,
          });
        }

        return { title: frontMatter?.title ?? null, optionsHash: salt, blocks };
      });

      return Renderer.of({ render });
    }),
  );
}

const frontMatterBlock = (range: Block["range"], salt: string): Block => {
  const hast: ElementContent[] = [];
  return { kind: "frontMatter", range, hash: hashBlock(hast, salt), hast };
};

/** Resolve every image once, after assembly and before the block is hashed. */
const resolveAssets = (
  hast: ElementContent[],
  line: number,
  options: RenderOptions,
): Effect.Effect<ElementContent[], RenderError> =>
  Effect.try({
    try: () => resolveImageSources(hast, options),
    catch: (cause) => new RenderError({ stage: "assets", line, message: describeCause(cause) }),
  });
