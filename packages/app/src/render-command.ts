import {
  blockToHtml,
  defaultRenderOptions,
  documentToHtml,
  type DocumentModel,
  Renderer,
  type RenderError,
} from "@mdv/core";
import { Effect, Schema } from "effect";
import { readFileSync } from "node:fs";

export class ReadError extends Schema.TaggedError<ReadError, { readonly brand: unique symbol }>()(
  "ReadError",
  {
    path: Schema.String,
    message: Schema.String,
  },
) {}

export type RenderCommandDeps = {
  readonly file: string;
  readonly write: (line: string) => void;
  /** Injected by tests so the command never touches the file system. */
  readonly readFile?: (path: string) => Effect.Effect<string, ReadError>;
};

const PREVIEW_LENGTH = 60;

const preview = (html: string): string =>
  html.length <= PREVIEW_LENGTH ? html : `${html.slice(0, PREVIEW_LENGTH)}…`;

const formatDocument = (document: DocumentModel): string[] => {
  const rows = document.blocks.map((block, index) =>
    [
      String(index + 1).padStart(4),
      `${block.range.startLine}-${block.range.endLine}`.padEnd(9),
      block.kind.padEnd(13),
      block.hash,
      `"${preview(blockToHtml(block))}"`,
    ].join("  "),
  );

  return [
    `title: ${document.title ?? "(none)"}`,
    `optionsHash: ${document.optionsHash}`,
    `blocks: ${document.blocks.length}`,
    ["  #", "range".padEnd(9), "kind".padEnd(13), "hash".padEnd(16), "html"].join("  "),
    ...rows,
    "--- html ---",
    documentToHtml(document),
  ];
};

export const runRender = (
  deps: RenderCommandDeps,
): Effect.Effect<DocumentModel, ReadError | RenderError, Renderer> =>
  Effect.gen(function* () {
    const readFile = deps.readFile ?? readFileFromDisk;
    const source = yield* readFile(deps.file);
    const renderer = yield* Renderer;
    const document = yield* renderer.render(source, defaultRenderOptions);

    for (const line of formatDocument(document)) deps.write(line);
    return document;
  });

const readFileFromDisk = (path: string): Effect.Effect<string, ReadError> =>
  Effect.try({
    try: () => readFileSync(path, "utf8"),
    catch: (cause) =>
      new ReadError({
        path,
        message: cause instanceof Error ? cause.message : String(cause),
      }),
  });
