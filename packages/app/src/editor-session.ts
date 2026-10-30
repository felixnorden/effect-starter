import type { CursorBlock, DocumentModel, RenderError, RenderOptions } from "@mdv/core";
import { previewTitle } from "@mdv/core";
import {
  configClassOf,
  configKeys,
  configurationErrorMessage,
  projectRenderOptions,
  validateConfiguration,
  type NormalizedConfiguration,
} from "@mdv/core/config";
import { createFrameDecoder, type FrameRead } from "@mdv/core/editor-frame";
import {
  EDITOR_PROTOCOL_VERSION,
  type ConfigurationMessage,
  type CursorMessage as EditorCursorMessage,
  type DocumentMessage,
  type ErrorMessage,
  type ServerToEditorMessage,
} from "@mdv/core/editor-protocol";
import type { CursorMessage as PageCursorMessage, SessionMessage } from "@mdv/core/protocol";
import { Effect, Equal, Result, Schema, Stream } from "effect";
import { basename } from "node:path";

import type { BuildError } from "./lifecycle.ts";
import { bindLine, endLine, type LogSink } from "./log-sink.ts";

/** The bound page: its one address, and the channels to its sources. */
export type PageHandle = {
  readonly url: string;
  readonly push: (document: DocumentMessage, force?: boolean) => Effect.Effect<void>;
  readonly pushSession: (member: SessionMessage) => Effect.Effect<void>;
  readonly pushCursor: (member: PageCursorMessage) => Effect.Effect<void>;
  /** The document sequence the page has applied; `0` before the first document. */
  readonly currentSeq: Effect.Effect<number>;
  /** The blocks of the applied document, identities included. */
  readonly currentBlocks: Effect.Effect<readonly CursorBlock[]>;
  /** The file the next stylesheet request for this slot may serve. */
  readonly setStylesheet: (
    slot: "markdown" | "code",
    file: { readonly path: string } | null,
  ) => Effect.Effect<void>;
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
    readonly render: (text: string) => Effect.Effect<DocumentModel, RenderError>;
  }) => Effect.Effect<PageHandle, PageError>;
  readonly render: (
    text: string,
    options: RenderOptions,
  ) => Effect.Effect<DocumentModel, RenderError>;
  readonly ensureClient: Effect.Effect<void, BuildError>;
  readonly stylesheet: (slot: "markdown" | "code", path: string) => Effect.Effect<string | null>;
  readonly resolveCursor: (input: {
    readonly blocks: readonly CursorBlock[];
    readonly line: number;
    readonly fraction: number;
    readonly seq: number;
  }) => PageCursorMessage | null;
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

const defaults = (): NormalizedConfiguration => {
  const validated = validateConfiguration([]);
  if (!validated.ok) throw new Error("the declaration produced no defaults");
  return validated.config;
};

const valueOf = (config: NormalizedConfiguration, key: string): unknown =>
  config.values[key]?.value;

const stringOf = (config: NormalizedConfiguration, key: string): string | null => {
  const value = valueOf(config, key);
  return typeof value === "string" ? value : null;
};

const booleanOf = (config: NormalizedConfiguration, key: string, fallback: boolean): boolean => {
  const value = valueOf(config, key);
  return typeof value === "boolean" ? value : fallback;
};

const classChanged = (
  previous: NormalizedConfiguration,
  next: NormalizedConfiguration,
  valueClass: "render" | "page-display",
): boolean =>
  configKeys().some((key) => {
    if (key.container || configClassOf(key.name) !== valueClass) return false;
    return !Equal.equals(valueOf(previous, key.name), valueOf(next, key.name));
  });

const sourceOf = (config: NormalizedConfiguration, key: string): string =>
  config.values[key]?.source ?? "default";

const scrollModeOf = (config: NormalizedConfiguration): "middle" | "top" | "relative" => {
  const value = valueOf(config, "scroll.mode");
  return value === "top" || value === "relative" ? value : "middle";
};

const themeModeOf = (config: NormalizedConfiguration): "system" | "light" | "dark" => {
  const value = valueOf(config, "theme.mode");
  return value === "light" || value === "dark" ? value : "system";
};

const entryKeyOf = (value: unknown): string | null =>
  value !== null && typeof value === "object" && "key" in value
    ? typeof (value as { readonly key: unknown }).key === "string"
      ? (value as { readonly key: string }).key
      : null
    : null;

const entryValueOf = (value: unknown): unknown =>
  value !== null && typeof value === "object" && "value" in value
    ? (value as { readonly value: unknown }).value
    : null;

/** A small stable id for the once-per-distinct-value report. */
const valueIdOf = (value: unknown): string => {
  if (value === null || value === undefined) return "nil";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return `[${value.length}]`;
  return "{object}";
};

/**
 * The server's one reader and one writer of the frame stream, and the one start
 * order: configuration, document, bind, client build, render, then `ready`. A
 * configuration frame that arrives first is already in effect; a document that
 * arrives first renders with defaults and the later configuration is a live
 * change. A page-display change sends one session member and calls no render; a
 * render change re-renders once from the retained text.
 */
export const runEditorSession = (deps: EditorSessionDeps): Effect.Effect<SessionCompletionReason> =>
  Effect.gen(function* () {
    const decoder = createFrameDecoder();
    let phase: "starting" | "open" = "starting";
    let page: PageHandle | null = null;
    let ended: SessionCompletionReason | null = null;
    let configuration = defaults();
    let retainedText: string | null = null;
    let lastModel: DocumentModel | null = null;
    let lastDocument: DocumentMessage | null = null;
    let lastFileName = "";
    const reported = new Map<string, string>();

    /** The one write call site: one frame, one destination. */
    const send = (message: ServerToEditorMessage): Effect.Effect<void> => deps.write(message);

    const end = (reason: SessionCompletionReason): void => {
      ended = reason;
      deps.sink.write(endLine(reason));
    };

    const completion = (): SessionCompletionReason | null => ended;

    const reportOnce = (id: string, message: string): Effect.Effect<void> => {
      if (reported.get(id) === message) return Effect.void;
      reported.set(id, message);
      return send(errorFrame("config", message));
    };

    const missingStylesheet = (key: string, path: string): string =>
      `Markdown Viewer: ${key} names ${path}, which cannot be read. Fix the path or unset the key.`;

    const pushSession = (): Effect.Effect<void> =>
      Effect.gen(function* () {
        if (page === null) return;

        const markdownPath = stringOf(configuration, "theme.markdown_css");
        const codePath = stringOf(configuration, "theme.code_css");
        let markdownCss: string | null = null;
        let codeCss: string | null = null;

        if (markdownPath !== null) {
          markdownCss = yield* deps.stylesheet("markdown", markdownPath);
          yield* page.setStylesheet(
            "markdown",
            markdownCss === null ? null : { path: markdownPath },
          );
          if (markdownCss === null) {
            yield* send(
              errorFrame("config", missingStylesheet("theme.markdown_css", markdownPath)),
            );
          }
        } else {
          yield* page.setStylesheet("markdown", null);
        }
        if (codePath !== null) {
          codeCss = yield* deps.stylesheet("code", codePath);
          yield* page.setStylesheet("code", codeCss === null ? null : { path: codePath });
          if (codeCss === null) {
            yield* send(errorFrame("config", missingStylesheet("theme.code_css", codePath)));
          }
        } else {
          yield* page.setStylesheet("code", null);
        }

        const template = stringOf(configuration, "preview.page_title") ?? "「${name}」";
        const member: SessionMessage = {
          _tag: "session",
          fileName: lastFileName,
          title: previewTitle({
            template,
            explicit: sourceOf(configuration, "preview.page_title") !== "default",
            name: lastFileName,
            frontMatterTitle: lastModel?.title ?? null,
          }),
          showFileName: booleanOf(configuration, "preview.show_filename", true),
          width: stringOf(configuration, "preview.width") ?? "900px",
          fontSize: stringOf(configuration, "preview.font_size") ?? "16px",
          markdownCss,
          codeCss,
          scrollMode: scrollModeOf(configuration),
          smoothScroll: booleanOf(configuration, "scroll.smooth", true),
          themeMode: themeModeOf(configuration),
        };

        yield* page.pushSession(member);
      });

    const applyConfiguration = (message: ConfigurationMessage): Effect.Effect<void> =>
      Effect.gen(function* () {
        const raw: unknown = message.values;
        if (!Array.isArray(raw)) {
          yield* send(errorFrame("config", "invalid configuration: values is not an array"));
          return;
        }

        const filtered: unknown[] = [];
        for (const entry of raw) {
          const key = entryKeyOf(entry);
          const valueClass = key === null ? null : configClassOf(key);
          if (key !== null && (valueClass === "editor" || valueClass === "endpoint")) {
            const received = valueIdOf(entryValueOf(entry));
            yield* reportOnce(
              `${key}=${received}`,
              `Markdown Viewer: ${key} applies at the next start.`,
            );
            continue;
          }
          filtered.push(entry);
        }

        const validated = validateConfiguration(filtered);
        if (!validated.ok) {
          yield* send(errorFrame("config", configurationErrorMessage(validated.rejection)));
          return;
        }

        const previous = configuration;
        configuration = validated.config;
        const renderChanged = classChanged(previous, configuration, "render");
        const displayChanged = classChanged(previous, configuration, "page-display");

        if (renderChanged && retainedText !== null && lastDocument !== null) {
          const rendered = yield* Effect.result(
            deps.render(retainedText, projectRenderOptions(configuration)),
          );
          if (Result.isFailure(rendered)) {
            yield* send(errorFrame("render", rendered.failure.message));
            return;
          }
          lastModel = rendered.success;
          if (page !== null) {
            yield* page.push({ ...lastDocument, text: retainedText }, true);
          }
        }

        if (displayChanged) yield* pushSession();
      });

    const onDocument = (message: DocumentMessage): Effect.Effect<void> =>
      Effect.gen(function* () {
        if (phase === "starting") {
          const bound = yield* Effect.result(
            deps.startPage({
              fileName: basename(message.path),
              path: message.path,
              render: (text) => deps.render(text, projectRenderOptions(configuration)),
            }),
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

          const rendered = yield* Effect.result(
            deps.render(message.text, projectRenderOptions(configuration)),
          );
          if (Result.isFailure(rendered)) {
            yield* send(errorFrame("render", rendered.failure.message));
            end("render");
            return;
          }

          yield* handle.push(message);
          retainedText = message.text;
          lastModel = rendered.success;
          lastDocument = message;
          lastFileName = basename(message.path);

          yield* send({
            _tag: "ready",
            editorProtocolVersion: EDITOR_PROTOCOL_VERSION,
            sessionId: deps.sessionId,
            url: handle.url,
          });
          yield* pushSession();
          phase = "open";
          return;
        }

        const rendered = yield* Effect.result(
          deps.render(message.text, projectRenderOptions(configuration)),
        );
        if (Result.isFailure(rendered)) {
          yield* send(errorFrame("render", rendered.failure.message));
          return;
        }
        yield* page!.push(message);
        const previousName = lastFileName;
        const previousTitle = lastModel?.title ?? null;
        const nextName = basename(message.path);
        retainedText = message.text;
        lastModel = rendered.success;
        lastDocument = message;
        lastFileName = nextName;
        if (nextName !== previousName || (rendered.success.title ?? null) !== previousTitle) {
          yield* pushSession();
        }
      });

    const onCursor = (message: EditorCursorMessage): Effect.Effect<void> =>
      Effect.gen(function* () {
        if (page === null) return;

        const seq = yield* page.currentSeq;
        if (seq === 0) return;

        const blocks = yield* page.currentBlocks;
        const resolved = deps.resolveCursor({
          blocks,
          line: message.line,
          fraction: message.fraction,
          seq,
        });
        // A line outside every block is a no-op, not an error frame.
        if (resolved === null) return;

        yield* page.pushCursor(resolved);
      });

    const onRead = (read: FrameRead): Effect.Effect<void> => {
      if (read._tag === "message") {
        const value = read.value;
        if (value._tag === "document") return onDocument(value);
        if (value._tag === "configuration") return applyConfiguration(value);
        if (value._tag === "cursor") return onCursor(value);
        return send(errorFrame("protocol", `unexpected editor message: ${value._tag}`));
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
