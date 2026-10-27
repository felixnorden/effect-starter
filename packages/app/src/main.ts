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
import { Cause, Effect, Exit, Layer, Ref } from "effect";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { openBrowser } from "./browser.ts";
import { parseArgs, UsageError } from "./cli.ts";
import { coalesce, type SourceSnapshot } from "./coalesce.ts";
import { DEV_PORT } from "./dev-config.ts";
import { BuildError, ensureClientBuild, preparePreview } from "./lifecycle.ts";
import { PreviewSession } from "./preview-session.ts";
import { ReadError, runRender } from "./render-command.ts";
import { startServer } from "./server.ts";
import { watchDirectory, WatchError } from "./watch.ts";

const clientDir = fileURLToPath(new URL("../dist/client", import.meta.url));
const clientIndex = fileURLToPath(new URL("../dist/client/index.html", import.meta.url));
const viteConfig = fileURLToPath(new URL("../vite.config.ts", import.meta.url));

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

const readSource = (file: string): Effect.Effect<string, ReadError> =>
  Effect.try({
    try: () => readFileSync(file, "utf8"),
    catch: (cause) =>
      new ReadError({
        path: file,
        message: cause instanceof Error ? cause.message : String(cause),
      }),
  });

const hashSource = (source: string): string => createHash("sha256").update(source).digest("hex");

const reasonOf = (cause: unknown): "missing" | "permission" | "other" => {
  const code =
    typeof cause === "object" && cause !== null && "code" in cause ? String(cause.code) : "";
  if (code === "ENOENT") return "missing";
  if (code === "EACCES" || code === "EPERM") return "permission";
  return "other";
};

/** The reader the watcher path uses: always the target file, never the event path. */
const readSnapshot = (file: string): Effect.Effect<SourceSnapshot, WatchError> =>
  Effect.try({
    try: () => {
      const source = readFileSync(file, "utf8");
      return { source, contentHash: hashSource(source) };
    },
    catch: (cause) =>
      new WatchError({
        path: file,
        reason: reasonOf(cause),
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
          const read = () => readSnapshot(absolute);

          const previewLayer = PreviewSession.layer({
            events: coalesce(watchDirectory(dirname(absolute)), read),
            read,
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
              localRoot: dirname(absolute),
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
