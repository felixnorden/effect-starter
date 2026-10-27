import type { DocumentModel, RenderError } from "@mdv/core";
import { createFrameDecoder, type FrameRead } from "@mdv/core/editor-frame";
import {
  EDITOR_PROTOCOL_VERSION,
  type DocumentMessage,
  type ErrorMessage,
  type ServerToEditorMessage,
} from "@mdv/core/editor-protocol";
import { Effect, Result, Schema, Stream } from "effect";
import { basename } from "node:path";

import type { BuildError } from "./lifecycle.ts";
import { bindLine, endLine, type LogSink } from "./log-sink.ts";

/** The bound page: its one address, and the source the next document enters. */
export type PageHandle = {
  readonly url: string;
  readonly push: (document: DocumentMessage) => Effect.Effect<void>;
};

export class PageError extends Schema.TaggedError<PageError, { readonly brand: unique symbol }>()(
  "PageError",
  {
    message: Schema.String,
  },
) {}

export type EditorSessionDeps = {
  readonly input: Stream.Stream<Uint8Array>;
  readonly write: (message: ServerToEditorMessage) => Effect.Effect<void>;
  readonly startPage: (options: {
    readonly fileName: string;
    readonly path: string;
  }) => Effect.Effect<PageHandle, PageError>;
  readonly render: (text: string) => Effect.Effect<DocumentModel, RenderError>;
  readonly ensureClient: Effect.Effect<void, BuildError>;
  readonly sink: LogSink;
  readonly sessionId: string;
};

/** Only `eof` exits `0`; every other reason exits `1` at the entrypoint. */
export type SessionCompletionReason = "eof" | "fatal" | "mismatch" | "bind" | "client" | "render";

const errorFrame = (
  stage: ErrorMessage["stage"],
  message: string,
  versions?: { readonly clientVersion: number; readonly serverVersion: number },
): ServerToEditorMessage => ({
  _tag: "error",
  editorProtocolVersion: EDITOR_PROTOCOL_VERSION,
  stage,
  message,
  ...versions,
});

/**
 * The server's one reader and one writer of the frame stream, and the one start
 * order: first document, bind, client build, render, then `ready` (decision 15).
 * A later document renders and answers nothing on success; an error while
 * starting is terminal, an error while open keeps the session (decisions 17, 18).
 */
export const runEditorSession = (deps: EditorSessionDeps): Effect.Effect<SessionCompletionReason> =>
  Effect.gen(function* () {
    const decoder = createFrameDecoder();
    let phase: "starting" | "open" = "starting";
    let page: PageHandle | null = null;
    let ended: SessionCompletionReason | null = null;

    /** The one write call site: one frame, one destination. */
    const send = (message: ServerToEditorMessage): Effect.Effect<void> => deps.write(message);

    const end = (reason: SessionCompletionReason): void => {
      ended = reason;
      deps.sink.write(endLine(reason));
    };

    const completion = (): SessionCompletionReason | null => ended;

    const onDocument = (message: DocumentMessage): Effect.Effect<void> =>
      Effect.gen(function* () {
        if (phase === "starting") {
          const bound = yield* Effect.result(
            deps.startPage({ fileName: basename(message.path), path: message.path }),
          );
          if (Result.isFailure(bound)) {
            yield* send(errorFrame("bind", bound.failure.message));
            end("bind");
            return;
          }

          const handle = bound.success;
          page = handle;
          deps.sink.write(bindLine(Date.now()));

          const built = yield* Effect.result(deps.ensureClient);
          if (Result.isFailure(built)) {
            yield* send(errorFrame("client", built.failure.message));
            end("client");
            return;
          }

          const rendered = yield* Effect.result(deps.render(message.text));
          if (Result.isFailure(rendered)) {
            yield* send(errorFrame("render", rendered.failure.message));
            end("render");
            return;
          }

          yield* handle.push(message);
          yield* send({
            _tag: "ready",
            editorProtocolVersion: EDITOR_PROTOCOL_VERSION,
            sessionId: deps.sessionId,
            url: handle.url,
          });
          phase = "open";
          return;
        }

        const rendered = yield* Effect.result(deps.render(message.text));
        if (Result.isFailure(rendered)) {
          yield* send(errorFrame("render", rendered.failure.message));
          return;
        }
        yield* page!.push(message);
      });

    const onRead = (read: FrameRead): Effect.Effect<void> => {
      if (read._tag === "message") {
        return read.value._tag === "document"
          ? onDocument(read.value)
          : send(errorFrame("protocol", `unexpected editor message: ${read.value._tag}`));
      }

      if (read._tag === "fatal") {
        return Effect.gen(function* () {
          yield* send(errorFrame("protocol", read.detail));
          end("fatal");
        });
      }

      return Effect.gen(function* () {
        const versions =
          read.clientVersion === undefined || read.serverVersion === undefined
            ? undefined
            : { clientVersion: read.clientVersion, serverVersion: read.serverVersion };
        yield* send(errorFrame("protocol", read.detail, versions));
        if (read.fault === "version") end("mismatch");
      });
    };

    yield* Stream.runForEachWhile(deps.input, (chunk) =>
      Effect.gen(function* () {
        for (const read of decoder.push(chunk)) {
          if (completion() !== null) break;
          yield* onRead(read);
        }
        return completion() === null;
      }),
    );

    if (completion() === null) end("eof");
    return completion() ?? "eof";
  });
