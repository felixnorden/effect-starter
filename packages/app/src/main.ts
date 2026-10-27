// @effect-diagnostics strictEffectProvide:off
// @effect-diagnostics unstableApiUsage:off
// @effect-diagnostics asyncFunction:off
import { BunHttpServer } from "@effect/platform-bun";
import {
  CodeHighlighting,
  defaultRenderOptions,
  DocumentSession,
  Renderer,
  type DocumentModel,
} from "@mdv/core";
import { logDirectoryFrom } from "@mdv/core/log-directory";
import { Cause, Config, Context, Effect, Exit, Layer, Ref, Scope } from "effect";
import * as FileSystem from "effect/FileSystem";
import * as HttpPlatform from "effect/http/HttpPlatform";
import * as HttpServer from "effect/http/HttpServer";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { openBrowser } from "./browser.ts";
import { parseArgs, UsageError } from "./cli.ts";
import { DEV_PORT } from "./dev-config.ts";
import { runEditorSession, type PageHandle } from "./editor-session.ts";
import { stdinChunks, writeStdout } from "./editor-stdio.ts";
import { BuildError, ensureClientBuild, preparePreview } from "./lifecycle.ts";
import { createLogSink, logFilePath } from "./log-sink.ts";
import { PreviewSession } from "./preview-session.ts";
import { ReadError, runRender } from "./render-command.ts";
import { startServer } from "./server.ts";
import { mintSessionId } from "./session-identity.ts";
import { fileSource, hashSource } from "./sources/file-source.ts";
import { createFrameSource } from "./sources/frame-source.ts";

const clientDir = fileURLToPath(new URL("../dist/client", import.meta.url));
const clientIndex = fileURLToPath(new URL("../dist/client/index.html", import.meta.url));
const viteConfig = fileURLToPath(new URL("../vite.config.ts", import.meta.url));

/** One megabyte per process; rotation waits for OP-7. */
const LOG_CAP_BYTES = 1024 * 1024;

const buildClient = (): Effect.Effect<void, BuildError> =>
  Effect.tryPromise({
    try: async () => {
      console.log("building client…");
      const { build } = await import("vite");
      await build({ configFile: viteConfig });
    },
    catch: (cause) =>
      new BuildError({
        message: cause instanceof Error ? cause.message : String(cause),
      }),
  });

/** Editor mode's standard output is the frame stream: Vite must stay silent. */
const buildClientQuietly = (): Effect.Effect<void, BuildError> =>
  Effect.tryPromise({
    try: async () => {
      const { build } = await import("vite");
      await build({ configFile: viteConfig, logLevel: "silent" });
    },
    catch: (cause) =>
      new BuildError({
        message: cause instanceof Error ? cause.message : String(cause),
      }),
  });

const readSource = (file: string): Effect.Effect<string, ReadError> =>
  Effect.try({
    try: () => readFileSync(file, "utf8"),
    catch: (cause) =>
      new ReadError({
        path: file,
        message: cause instanceof Error ? cause.message : String(cause),
      }),
  });

/**
 * `preview` binds an OS-assigned port and opens a browser. `dev` binds the one
 * fixed dev-only port and opens nothing, so Vite's proxy can reach it.
 */
const runServer = (file: string, open: boolean) =>
  Effect.gen(function* () {
    const renderer = yield* Renderer;
    const absolute = resolve(file);
    const rendered = yield* Ref.make<DocumentModel | null>(null);
    const initialSource = yield* Ref.make("");

    return yield* preparePreview({
      render: () =>
        Effect.gen(function* () {
          const source = yield* readSource(absolute);
          const document = yield* renderer.render(source, defaultRenderOptions);
          yield* Ref.set(rendered, document);
          yield* Ref.set(initialSource, source);
        }),
      ensureClient: ensureClientBuild({
        exists: () => existsSync(clientIndex),
        build: buildClient,
      }),
      start: () =>
        Effect.gen(function* () {
          const document = yield* Ref.get(rendered);
          if (document === null) {
            return yield* Effect.die(new Error("render did not produce a document"));
          }
          const source = yield* Ref.get(initialSource);
          const fileProducer = fileSource(absolute);

          const previewLayer = PreviewSession.layer({
            events: fileProducer.events,
            read: fileProducer.read,
            initialContentHash: hashSource(source),
            initialDocument: document,
            render: (next) => renderer.render(next, defaultRenderOptions),
          }).pipe(Layer.provide(DocumentSession.layer));

          // The layer scope must outlive the startup read: the watcher and the
          // update stream live as long as the server, so this effect never ends.
          return yield* Effect.gen(function* () {
            const preview = yield* PreviewSession;
            const handle = yield* startServer({
              clientDir,
              localRoot: fileProducer.localRoot,
              imageRoot: defaultRenderOptions.imageRoot,
              fileName: basename(file),
              title: document.title,
              currentSnapshot: preview.currentSnapshot,
              updates: preview.updates,
            });
            // Catch a save that landed between the startup render and the watch.
            yield* preview.readOnce;

            console.log(handle.url);
            if (open) yield* openBrowser(handle.url);
            return yield* Effect.never;
          }).pipe(Effect.provide(previewLayer));
        }),
    });
  });

/**
 * Each adapter resolves the cache directory in its own language and passes
 * `--log-file`; this is the server's fallback when the flag is absent.
 */
const editorLogDirectory = Effect.gen(function* () {
  const xdgCacheHome = yield* Config.String("XDG_CACHE_HOME").pipe(Config.withDefault(""));
  const localAppData = yield* Config.String("LOCALAPPDATA").pipe(Config.withDefault(""));
  return logDirectoryFrom({
    platform: process.platform,
    xdgCacheHome,
    localAppData,
    home: homedir(),
    tmp: tmpdir(),
  });
}).pipe(
  Effect.orElseSucceed(() =>
    logDirectoryFrom({ platform: process.platform, home: homedir(), tmp: tmpdir() }),
  ),
);

/**
 * One editor session: frames in on standard input, frames out on standard
 * output, one page bound after the first document, and logs in a file.
 */
const runEditor = (
  logFile: string | null,
): Effect.Effect<
  number,
  never,
  Renderer | HttpServer.HttpServer | HttpPlatform.HttpPlatform | FileSystem.FileSystem
> =>
  Effect.gen(function* () {
    const renderer = yield* Renderer;
    const httpContext = yield* Effect.context<
      HttpServer.HttpServer | HttpPlatform.HttpPlatform | FileSystem.FileSystem
    >();

    const directory = yield* editorLogDirectory;
    const path = logFile ?? logFilePath({ directory: directory.dir, pid: process.pid });
    yield* Effect.sync(() => mkdirSync(dirname(path), { recursive: true }));

    const sink = createLogSink({
      path,
      directory: directory.dir,
      pid: process.pid,
      capBytes: LOG_CAP_BYTES,
      append: (target, text) => appendFileSync(target, text),
    });

    const startPage = (options: {
      readonly fileName: string;
      readonly path: string;
    }): Effect.Effect<PageHandle> =>
      Effect.gen(function* () {
        const localRoot = options.path === "" ? null : dirname(options.path);
        const frameProducer = yield* createFrameSource({
          render: (text) => renderer.render(text, defaultRenderOptions),
        });

        // One page per process: the session layer's scope outlives this call.
        const pageScope = yield* Scope.make();
        const pageLayer = PreviewSession.layer(frameProducer.deps).pipe(
          Layer.provide(DocumentSession.layer),
        );
        const pageContext = yield* Layer.build(pageLayer).pipe(
          Effect.provideService(Scope.Scope, pageScope),
        );
        const preview = Context.get(pageContext, PreviewSession);

        const handle = yield* startServer({
          clientDir,
          localRoot,
          imageRoot: defaultRenderOptions.imageRoot,
          fileName: options.fileName,
          title: null,
          currentSnapshot: preview.currentSnapshot,
          updates: preview.updates,
        }).pipe(Effect.provideContext(httpContext));

        return { url: handle.url, push: frameProducer.push };
      });

    const reason = yield* runEditorSession({
      input: stdinChunks,
      write: writeStdout,
      startPage,
      render: (text) => renderer.render(text, defaultRenderOptions),
      ensureClient: ensureClientBuild({
        exists: () => existsSync(clientIndex),
        build: buildClientQuietly,
      }),
      sink,
      sessionId: mintSessionId(),
    });

    return reason === "eof" ? 0 : 1;
  });

const command = parseArgs(process.argv.slice(2));

const baseLayer = Layer.merge(
  Renderer.layer.pipe(Layer.provide(CodeHighlighting.layer)),
  DocumentSession.layer,
);

const httpLayer = BunHttpServer.layer({
  hostname: "127.0.0.1",
  port: command instanceof UsageError || command._tag !== "dev" ? 0 : DEV_PORT,
});

const failureMessage = async (effect: Effect.Effect<unknown, Error>): Promise<string | null> => {
  const exit = await Effect.runPromiseExit(effect);
  if (Exit.isSuccess(exit)) return null;
  const error = Cause.squash(exit.cause);
  return typeof error === "object" && error !== null && "message" in error
    ? String(error.message)
    : String(error);
};

const run = async (): Promise<string | null> => {
  if (command instanceof UsageError) {
    return failureMessage(Effect.fail(command).pipe(Effect.provide(baseLayer)));
  }
  if (command._tag === "render") {
    return failureMessage(
      runRender({ file: command.file, write: (line) => console.log(line) }).pipe(
        Effect.provide(baseLayer),
      ),
    );
  }
  if (command._tag === "editor") {
    const exit = await Effect.runPromiseExit(
      runEditor(command.logFile).pipe(Effect.provide(Layer.merge(baseLayer, httpLayer))),
    );
    if (Exit.isFailure(exit)) {
      const error = Cause.squash(exit.cause);
      return typeof error === "object" && error !== null && "message" in error
        ? String(error.message)
        : String(error);
    }
    // The page server holds an open listener; end-of-input ends the process.
    process.exit(exit.value);
  }
  return failureMessage(
    runServer(command.file, command._tag === "preview").pipe(
      Effect.provide(Layer.merge(baseLayer, httpLayer)),
    ),
  );
};

const failure = await run();

if (failure !== null) {
  console.error(failure);
  process.exitCode = 1;
}
