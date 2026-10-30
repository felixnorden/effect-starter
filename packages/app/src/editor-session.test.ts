// @effect-diagnostics strictEffectProvide:off
// @effect-diagnostics unstableApiUsage:off
import { it } from "@effect/vitest";
import { NodeHttpServer } from "@effect/platform-node";
import {
  DocumentSession,
  RenderError,
  resolveLine,
  type BlockId,
  type CursorBlock,
  type DocumentModel,
  type RenderOptions,
} from "@mdv/core";
import { MAX_FRAME_BYTES, encodeFrame } from "@mdv/core/editor-frame";
import {
  EDITOR_PROTOCOL_VERSION,
  type ConfigurationMessage,
  type DocumentMessage,
  type ServerToEditorMessage,
} from "@mdv/core/editor-protocol";
import type { CursorMessage, ServerMessage, SessionMessage } from "@mdv/core/protocol";
import { Cause, Context, Effect, Fiber, Layer, Queue, Scope, Stream } from "effect";
import * as FileSystem from "effect/FileSystem";
import * as HttpPlatform from "effect/http/HttpPlatform";
import * as HttpServer from "effect/http/HttpServer";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect } from "vitest";

import { runEditorSession, PageError, type PageHandle } from "./editor-session.ts";
import { BuildError } from "./lifecycle.ts";
import { PreviewSession } from "./preview-session.ts";
import { startServer } from "./server.ts";
import { createFrameSource } from "./sources/frame-source.ts";

const documentOf = (text: string, path = "/docs/a.md"): DocumentMessage => ({
  _tag: "document",
  editorProtocolVersion: EDITOR_PROTOCOL_VERSION,
  path,
  text,
});

const configurationOf = (
  values: readonly { readonly key: string; readonly value: unknown; readonly source: string }[],
): ConfigurationMessage => ({
  _tag: "configuration",
  editorProtocolVersion: EDITOR_PROTOCOL_VERSION,
  values,
});

const modelOf = (): DocumentModel => ({ title: null, optionsHash: "options", blocks: [] });

const fixtureBlocks = [
  { id: "b1" as BlockId, range: { startLine: 1, endLine: 4 } },
  { id: "b2" as BlockId, range: { startLine: 5, endLine: 9 } },
  { id: "b3" as BlockId, range: { startLine: 10, endLine: 12 } },
];

const modelOfWithText = (text: string): DocumentModel => ({
  title: null,
  optionsHash: "options",
  blocks: [
    {
      range: { startLine: 1, endLine: 1 },
      kind: "heading",
      hash: "heading",
      hast: [{ type: "text", value: text }],
    },
  ],
});

const textOf = (node: unknown): string => {
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (node === null || typeof node !== "object") return "";
  const value = (node as { readonly value?: unknown }).value;
  if (typeof value === "string") return value;
  const children = (node as { readonly children?: unknown }).children;
  return Array.isArray(children) ? children.map(textOf).join("") : "";
};

const concat = (frames: readonly Uint8Array[]): Uint8Array => {
  const length = frames.reduce((total, frame) => total + frame.length, 0);
  const result = new Uint8Array(length);
  let offset = 0;
  for (const frame of frames) {
    result.set(frame, offset);
    offset += frame.length;
  }
  return result;
};

type SessionRun = {
  readonly written: readonly ServerToEditorMessage[];
  readonly lines: readonly string[];
  readonly renders: readonly string[];
  readonly renderOptions: readonly RenderOptions[];
  readonly pushes: readonly DocumentMessage[];
  readonly sessions: readonly SessionMessage[];
  readonly cursors: readonly CursorMessage[];
  readonly pages: readonly { readonly fileName: string; readonly path: string }[];
  readonly order: readonly string[];
  readonly reason: string;
};

type HarnessOptions = {
  readonly chunks?: readonly (readonly Uint8Array[])[];
  readonly startPage?: (options: {
    readonly fileName: string;
    readonly path: string;
    readonly render: (text: string) => Effect.Effect<DocumentModel, RenderError>;
  }) => Effect.Effect<PageHandle, PageError>;
  readonly render?: (
    text: string,
    options: RenderOptions,
  ) => Effect.Effect<DocumentModel, import("@mdv/core").RenderError>;
  readonly ensureClient?: Effect.Effect<void, BuildError>;
  readonly stylesheet?: (slot: "markdown" | "code", path: string) => Effect.Effect<string | null>;
  readonly sinkSuffix?: string;
  readonly sessionId?: string;
};

const runSession = (options: HarnessOptions = {}): Effect.Effect<SessionRun> =>
  Effect.gen(function* () {
    const queue = yield* Queue.unbounded<Uint8Array, Cause.Done>();
    const written: ServerToEditorMessage[] = [];
    const lines: string[] = [];
    const renders: string[] = [];
    const renderOptions: RenderOptions[] = [];
    const pushes: DocumentMessage[] = [];
    const sessions: SessionMessage[] = [];
    const cursors: CursorMessage[] = [];
    const pages: { fileName: string; path: string }[] = [];
    const order: string[] = [];
    let pageSeq = 0;

    const startPage =
      options.startPage ??
      (() =>
        Effect.succeed({
          url: "http://127.0.0.1:4321/",
          push: (document: DocumentMessage) =>
            Effect.sync(() => {
              pushes.push(document);
              pageSeq += 1;
            }),
          pushSession: (member: SessionMessage) =>
            Effect.sync(() => {
              sessions.push(member);
            }),
          pushCursor: (member: CursorMessage) =>
            Effect.sync(() => {
              cursors.push(member);
            }),
          currentSeq: Effect.sync(() => pageSeq),
          currentBlocks: Effect.succeed(fixtureBlocks),
          setStylesheet: () => Effect.void,
        }));

    const fiber = yield* Effect.forkChild(
      runEditorSession({
        input: Stream.fromQueue(queue),
        write: (message) =>
          Effect.sync(() => {
            written.push(message);
            order.push(message._tag === "ready" ? "ready" : "error");
          }),
        startPage: (pageOptions) =>
          Effect.sync(() => {
            pages.push({ fileName: pageOptions.fileName, path: pageOptions.path });
            order.push("bind");
          }).pipe(Effect.andThen(startPage(pageOptions))),
        render: (text, renderOptionsValue) =>
          Effect.sync(() => {
            renders.push(text);
            renderOptions.push(renderOptionsValue);
            order.push("render");
          }).pipe(
            Effect.andThen(options.render?.(text, renderOptionsValue) ?? Effect.succeed(modelOf())),
          ),
        ensureClient: Effect.sync(() => {
          order.push("build");
        }).pipe(Effect.andThen(options.ensureClient ?? Effect.void)),
        stylesheet: options.stylesheet ?? (() => Effect.succeed("/stylesheet/slot/hash")),
        resolveCursor: (input) => {
          const resolved = resolveLine(input);
          return resolved === null ? null : { _tag: "cursor", ...resolved };
        },
        sink: {
          write: (line) => {
            lines.push(options.sinkSuffix === undefined ? line : `${line} ${options.sinkSuffix}`);
          },
        },
        sessionId: options.sessionId ?? "session-1",
      }),
    );

    for (const chunk of options.chunks ?? []) {
      Queue.offerUnsafe(queue, concat(chunk));
    }
    yield* Queue.end(queue);

    const reason = yield* Fiber.join(fiber);
    return {
      written,
      lines,
      renders,
      renderOptions,
      pushes,
      sessions,
      cursors,
      pages,
      order,
      reason,
    };
  });

describe("runEditorSession", () => {
  it.effect("answers ready after one document frame", () =>
    Effect.gen(function* () {
      const run = yield* runSession({ chunks: [[encodeFrame(documentOf("# hello\n"))]] });

      expect(run.written).toEqual([
        {
          _tag: "ready",
          editorProtocolVersion: EDITOR_PROTOCOL_VERSION,
          sessionId: "session-1",
          url: "http://127.0.0.1:4321/",
        },
      ]);
      expect(run.renders).toEqual(["# hello\n"]);
      expect(run.pages).toEqual([{ fileName: "a.md", path: "/docs/a.md" }]);
      expect(run.reason).toBe("eof");
    }),
  );

  it.effect("writes one bind line with an epoch timestamp and no address", () =>
    Effect.gen(function* () {
      const before = Date.now();
      const run = yield* runSession({ chunks: [[encodeFrame(documentOf("# hello\n"))]] });

      const bind = run.lines.find((line) => line.startsWith("bind "));
      const value = Number(bind?.match(/epochMs=(\d+)/)?.[1]);

      expect(bind).toBeDefined();
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(before);
      expect(run.lines.join("\n")).not.toContain("http");
    }),
  );

  it.effect("answers one error for an undecodable line and keeps the stream open", () =>
    Effect.gen(function* () {
      const run = yield* runSession({
        chunks: [[new TextEncoder().encode("not json\n")], [encodeFrame(documentOf("# after\n"))]],
      });

      expect(run.written).toHaveLength(2);
      expect(run.written[0]).toMatchObject({ _tag: "error", stage: "protocol" });
      expect(run.written[1]).toMatchObject({ _tag: "ready" });
    }),
  );

  it.effect("reports both versions and ends the loop on a mismatch", () =>
    Effect.gen(function* () {
      const mismatched = {
        ...documentOf("# old\n"),
        editorProtocolVersion: EDITOR_PROTOCOL_VERSION + 1,
      };
      const run = yield* runSession({
        chunks: [[encodeFrame(mismatched)], [encodeFrame(documentOf("# new\n"))]],
      });

      expect(run.written).toHaveLength(1);
      const [message] = run.written;
      expect(message?._tag).toBe("error");
      if (message?._tag === "error") {
        expect(message.message).toContain(String(EDITOR_PROTOCOL_VERSION + 1));
        expect(message.message).toContain(String(EDITOR_PROTOCOL_VERSION));
      }
      expect(run.reason).toBe("mismatch");
    }),
  );

  it.effect("ends the loop and the process contract on a cap violation", () =>
    Effect.gen(function* () {
      const run = yield* runSession({
        chunks: [[new Uint8Array(MAX_FRAME_BYTES + 1)], [encodeFrame(documentOf("# after\n"))]],
      });

      expect(run.written).toHaveLength(1);
      expect(run.written[0]).toMatchObject({ _tag: "error", stage: "protocol" });
      expect(run.reason).toBe("fatal");
    }),
  );

  it.effect("ends the loop at end-of-input", () =>
    Effect.gen(function* () {
      const run = yield* runSession();

      expect(run.reason).toBe("eof");
      expect(run.lines.at(-1)).toContain("eof");
    }),
  );

  it.effect("keeps frame order when one chunk holds two documents", () =>
    Effect.gen(function* () {
      const run = yield* runSession({
        chunks: [[encodeFrame(documentOf("# first\n")), encodeFrame(documentOf("# second\n"))]],
      });

      expect(run.written).toHaveLength(1);
      expect(run.written[0]?._tag).toBe("ready");
      expect(run.renders).toEqual(["# first\n", "# second\n"]);
    }),
  );

  it.effect("never writes a log line to the frame stream", () =>
    Effect.gen(function* () {
      const run = yield* runSession({
        chunks: [[encodeFrame(documentOf("# hello\n"))], [new TextEncoder().encode("bad\n")]],
        sinkSuffix: "MARKER-7f3a",
      });

      const frames = run.written
        .map((message) =>
          message._tag === "ready"
            ? `${message._tag} ${message.sessionId} ${message.url}`
            : `${message._tag} ${message.stage} ${message.message}`,
        )
        .join(" ");

      expect(run.lines.join("\n")).toContain("MARKER-7f3a");
      expect(frames).not.toContain("MARKER-7f3a");
    }),
  );

  it.effect("answers ready with the page address after the first rendered document", () =>
    Effect.gen(function* () {
      const run = yield* runSession({ chunks: [[encodeFrame(documentOf("# hello\n"))]] });

      const ready = run.written[0];
      expect(ready?._tag).toBe("ready");
      if (ready?._tag === "ready") {
        expect(ready.url).toBe("http://127.0.0.1:4321/");
        expect(ready.sessionId.length).toBeGreaterThan(0);
      }
      expect(run.pages).toEqual([{ fileName: "a.md", path: "/docs/a.md" }]);
      expect(run.order.indexOf("ready")).toBeGreaterThan(run.order.indexOf("render"));
    }),
  );

  it.effect("binds after the first document and builds the client there", () =>
    Effect.gen(function* () {
      const run = yield* runSession({ chunks: [[encodeFrame(documentOf("# hello\n"))]] });

      expect(run.order.slice(0, 4)).toEqual(["bind", "build", "render", "ready"]);
    }),
  );

  it.effect("answers no ready when the first render fails", () =>
    Effect.gen(function* () {
      const run = yield* runSession({
        chunks: [[encodeFrame(documentOf("# hello\n"))]],
        render: () => Effect.fail(new RenderError({ stage: "parse", line: 1, message: "boom" })),
      });

      expect(run.written).toHaveLength(1);
      expect(run.written[0]).toMatchObject({ _tag: "error", stage: "render" });
      expect(run.written.some((message) => message._tag === "ready")).toBe(false);
      expect(run.reason).toBe("render");
    }),
  );

  it.effect("answers a client error when the build fails", () =>
    Effect.gen(function* () {
      const run = yield* runSession({
        chunks: [[encodeFrame(documentOf("# hello\n"))]],
        ensureClient: Effect.fail(new BuildError({ message: "vite failed" })),
      });

      expect(run.written).toHaveLength(1);
      expect(run.written[0]).toMatchObject({ _tag: "error", stage: "client" });
      expect(run.written.some((message) => message._tag === "ready")).toBe(false);
      expect(run.reason).toBe("client");
    }),
  );

  it.effect("answers an error when the page cannot bind", () =>
    Effect.gen(function* () {
      const run = yield* runSession({
        chunks: [[encodeFrame(documentOf("# hello\n"))]],
        startPage: () => Effect.fail(new PageError({ message: "port busy" })),
      });

      expect(run.written).toHaveLength(1);
      expect(run.written[0]).toMatchObject({ _tag: "error", stage: "bind" });
      expect(run.reason).toBe("bind");
    }),
  );

  it.effect("answers one snapshot and no second ready for a later document", () =>
    Effect.gen(function* () {
      const run = yield* runSession({
        chunks: [[encodeFrame(documentOf("# first\n"))], [encodeFrame(documentOf("# second\n"))]],
      });

      expect(run.written).toHaveLength(1);
      expect(run.written[0]?._tag).toBe("ready");
      expect(run.pushes).toHaveLength(2);
      expect(run.reason).toBe("eof");
    }),
  );

  it.effect("a rebind pushes one session member with the new file name and title", () =>
    Effect.gen(function* () {
      const run = yield* runSession({
        chunks: [
          [encodeFrame(documentOf("# one\n", "/docs/a.md"))],
          [encodeFrame(documentOf("# two\n", "/other/b.md"))],
        ],
        render: (text) =>
          Effect.succeed({
            ...modelOf(),
            title: text.includes("two") ? "Notes B" : null,
          }),
      });

      const rebound = run.sessions.filter((member) => member.fileName === "b.md");
      expect(rebound).toHaveLength(1);
      expect(rebound[0]?.title).toBe("Notes B");
      expect(run.sessions[0]?.fileName).toBe("a.md");
    }),
  );

  it.effect("keeps the row and the page when a later render fails", () =>
    Effect.gen(function* () {
      const run = yield* runSession({
        chunks: [[encodeFrame(documentOf("# first\n"))], [encodeFrame(documentOf("# boom\n"))]],
        render: (text) =>
          text.includes("boom")
            ? Effect.fail(new RenderError({ stage: "parse", line: 1, message: "boom" }))
            : Effect.succeed(modelOf()),
      });

      expect(run.written.map((message) => message._tag)).toEqual(["ready", "error"]);
      expect(run.written[1]).toMatchObject({ stage: "render" });
      expect(run.pushes).toHaveLength(1);
      expect(run.reason).toBe("eof");
    }),
  );

  it.effect("a rebound document moves the local root", () =>
    Effect.gen(function* () {
      const source = yield* createFrameSource({
        render: () => Effect.succeed(modelOf()),
      });
      yield* runSession({
        chunks: [
          [encodeFrame(documentOf("# one\n", "/docs/a.md"))],
          [encodeFrame(documentOf("# two\n", "/other/b.md"))],
        ],
        startPage: () =>
          Effect.succeed({
            url: "http://127.0.0.1:4321/",
            push: source.push,
            pushSession: () => Effect.void,
            pushCursor: () => Effect.void,
            currentSeq: Effect.succeed(1),
            currentBlocks: Effect.succeed(fixtureBlocks),
            setStylesheet: () => Effect.void,
          }),
      });

      expect(yield* source.localRoot).toBe("/other");
    }),
  );

  it.effect("a cursor frame sends one page cursor member and calls no render", () =>
    Effect.gen(function* () {
      const run = yield* runSession({
        chunks: [
          [encodeFrame(documentOf("# hello\n"))],
          [
            encodeFrame({
              _tag: "cursor",
              editorProtocolVersion: EDITOR_PROTOCOL_VERSION,
              line: 7,
              fraction: 0.5,
            }),
          ],
        ],
      });

      expect(run.renders).toHaveLength(1);
      expect(run.cursors).toEqual([
        { _tag: "cursor", blockId: "b2", line: 7, fraction: 0.5, seq: 1 },
      ]);
      expect(run.written.map((message) => message._tag)).toEqual(["ready"]);
    }),
  );

  it.effect("a cursor outside every block sends nothing", () =>
    Effect.gen(function* () {
      const run = yield* runSession({
        chunks: [
          [encodeFrame(documentOf("# hello\n"))],
          [
            encodeFrame({
              _tag: "cursor",
              editorProtocolVersion: EDITOR_PROTOCOL_VERSION,
              line: 40,
              fraction: 0.5,
            }),
          ],
        ],
      });

      expect(run.renders).toHaveLength(1);
      expect(run.cursors).toHaveLength(0);
      expect(run.written.map((message) => message._tag)).toEqual(["ready"]);
    }),
  );

  it.effect("serves the pushed text at the page address", () =>
    Effect.gen(function* () {
      const clientDir = mkdtempSync(join(tmpdir(), "mdv-editor-page-"));
      writeFileSync(join(clientDir, "index.html"), "page");

      const run = yield* Effect.gen(function* () {
        const httpContext = yield* Effect.context<
          HttpServer.HttpServer | HttpPlatform.HttpPlatform | FileSystem.FileSystem
        >();
        let snapshot: Effect.Effect<ServerMessage | null> = Effect.succeed(null);

        const startPage = (options: {
          fileName: string;
          path: string;
          render: (text: string) => Effect.Effect<DocumentModel, RenderError>;
        }) =>
          Effect.gen(function* () {
            const source = yield* createFrameSource({ render: options.render });
            const pageScope = yield* Scope.make();
            const pageContext = yield* Layer.build(
              PreviewSession.layer(source.deps).pipe(Layer.provide(DocumentSession.layer)),
            ).pipe(Effect.provideService(Scope.Scope, pageScope));
            const preview = Context.get(pageContext, PreviewSession);
            snapshot = preview.currentSnapshot;

            const handle = yield* startServer({
              clientDir,
              localRoot: null,
              imageRoot: null,
              fileName: options.fileName,
              title: null,
              currentSnapshot: preview.currentSnapshot,
              currentSession: Effect.succeed(null),
              currentCursor: Effect.succeed(null),
              stylesheets: Effect.succeed({ markdown: null, code: null }),
              updates: preview.updates,
            }).pipe(Effect.provideContext(httpContext));

            return {
              url: handle.url,
              push: source.push,
              pushSession: () => Effect.void,
              pushCursor: () => Effect.void,
              currentSeq: preview.state.pipe(Effect.map((state) => state?.seq ?? 0)),
              currentBlocks: preview.state.pipe(
                Effect.map((state): readonly CursorBlock[] => state?.blocks ?? []),
              ),
              setStylesheet: () => Effect.void,
            };
          });

        const queue = yield* Queue.unbounded<Uint8Array, Cause.Done>();
        const written: ServerToEditorMessage[] = [];
        const fiber = yield* runEditorSession({
          input: Stream.fromQueue(queue),
          write: (message) =>
            Effect.sync(() => {
              written.push(message);
            }),
          startPage,
          render: (text) => Effect.succeed(modelOfWithText(text)),
          ensureClient: Effect.void,
          stylesheet: () => Effect.succeed("/stylesheet/slot/hash"),
          resolveCursor: () => null,
          sink: { write: () => {} },
          sessionId: "session-1",
        }).pipe(Effect.forkChild);

        Queue.offerUnsafe(queue, encodeFrame(documentOf("# from the buffer\n")));

        let ready: ServerToEditorMessage | undefined;
        for (let attempt = 0; attempt < 200 && ready === undefined; attempt += 1) {
          yield* Effect.yieldNow;
          ready = written.find((message) => message._tag === "ready");
        }
        if (ready === undefined || ready._tag !== "ready") {
          return yield* Effect.die(new Error("no ready frame"));
        }

        for (let attempt = 0; attempt < 50; attempt += 1) yield* Effect.yieldNow;
        const current = yield* snapshot;
        const response = yield* Effect.promise(() => fetch(ready.url));

        yield* Queue.end(queue);
        yield* Fiber.await(fiber);
        return {
          ready,
          current,
          status: response.status,
          body: yield* Effect.promise(() => response.text()),
        };
      }).pipe(Effect.provide(NodeHttpServer.layerTest));

      expect(run.status).toBe(200);
      expect(run.body).toBe("page");
      expect(run.ready._tag).toBe("ready");
      expect(run.current?._tag).toBe("snapshot");
      if (run.current?._tag === "snapshot") {
        expect(run.current.blocks.map((block) => textOf(block.hast)).join(" ")).toContain(
          "from the buffer",
        );
      }

      rmSync(clientDir, { recursive: true, force: true });
    }),
  );

  it.effect("renders once with the configuration frame that arrives first", () =>
    Effect.gen(function* () {
      const run = yield* runSession({
        chunks: [
          [
            encodeFrame(
              configurationOf([
                {
                  key: "render.markdown_it",
                  value: { breaks: true },
                  source: "setup:render.markdown_it",
                },
              ]),
            ),
            encodeFrame(documentOf("# hello\n")),
          ],
        ],
      });

      expect(run.renders).toHaveLength(1);
      expect(run.renderOptions[0]?.breaks).toBe(true);
      expect(run.written[0]?._tag).toBe("ready");
      expect(run.sessions).toHaveLength(1);
    }),
  );

  it.effect(
    "renders with defaults when the document arrives first and applies the later configuration",
    () =>
      Effect.gen(function* () {
        const run = yield* runSession({
          chunks: [
            [encodeFrame(documentOf("# hello\n"))],
            [
              encodeFrame(
                configurationOf([
                  {
                    key: "render.markdown_it",
                    value: { breaks: true },
                    source: "setup:render.markdown_it",
                  },
                ]),
              ),
            ],
          ],
        });

        expect(run.renders).toHaveLength(2);
        expect(run.renderOptions[0]?.breaks).toBe(false);
        expect(run.renderOptions[1]?.breaks).toBe(true);
        expect(run.written[0]?._tag).toBe("ready");
      }),
  );

  it.effect("a page-display change sends one session member and calls no render", () =>
    Effect.gen(function* () {
      const run = yield* runSession({
        chunks: [
          [encodeFrame(documentOf("# hello\n"))],
          [
            encodeFrame(
              configurationOf([
                { key: "preview.width", value: "1200px", source: "setup:preview.width" },
              ]),
            ),
          ],
        ],
      });

      expect(run.renders).toHaveLength(1);
      expect(run.sessions).toHaveLength(2);
      expect(run.sessions[1]?.width).toBe("1200px");
    }),
  );

  it.effect("a configuration frame whose values is not an array answers one config error", () =>
    Effect.gen(function* () {
      const malformed = {
        _tag: "configuration",
        editorProtocolVersion: EDITOR_PROTOCOL_VERSION,
        values: { key: "preview.width" },
      } as unknown as ConfigurationMessage;
      const run = yield* runSession({
        chunks: [[encodeFrame(documentOf("# hello\n"))], [encodeFrame(malformed)]],
      });

      expect(run.written.at(-1)).toMatchObject({
        _tag: "error",
        stage: "config",
        message: "invalid configuration: values is not an array",
      });
    }),
  );

  it.effect("a frame replaces the cell, so a reverted key returns to its default", () =>
    Effect.gen(function* () {
      const run = yield* runSession({
        chunks: [
          [encodeFrame(documentOf("# hello\n"))],
          [
            encodeFrame(
              configurationOf([
                { key: "preview.width", value: "1200px", source: "setup:preview.width" },
              ]),
            ),
          ],
          [encodeFrame(configurationOf([]))],
        ],
      });

      expect(run.sessions.at(-1)?.width).toBe("900px");
      expect(run.sessions.at(-1)?._tag).toBe("session");
    }),
  );

  it.effect("a configured stylesheet path that names no file answers one config error", () =>
    Effect.gen(function* () {
      const run = yield* runSession({
        chunks: [
          [encodeFrame(documentOf("# hello\n"))],
          [
            encodeFrame(
              configurationOf([
                {
                  key: "theme.markdown_css",
                  value: "/missing.css",
                  source: "setup:theme.markdown_css",
                },
              ]),
            ),
          ],
          [encodeFrame(documentOf("# again\n"))],
        ],
        stylesheet: () => Effect.succeed(null),
      });

      const errors = run.written.filter((message) => message._tag === "error");
      expect(errors).toHaveLength(1);
      const [error] = errors;
      expect(error?._tag === "error" ? error.stage : null).toBe("config");
      expect(error?._tag === "error" ? error.message : "").toContain("theme.markdown_css");
      expect(error?._tag === "error" ? error.message : "").toContain("/missing.css");
      expect(run.sessions.at(-1)?.markdownCss).toBeNull();
      expect(run.renders).toHaveLength(2);
    }),
  );

  it.effect("an endpoint-class value applies only at the next start", () =>
    Effect.gen(function* () {
      const run = yield* runSession({
        chunks: [
          [encodeFrame(documentOf("# hello\n"))],
          [
            encodeFrame(
              configurationOf([{ key: "server.port", value: 4789, source: "setup:server.port" }]),
            ),
          ],
        ],
      });

      const errors = run.written.filter((message) => message._tag === "error");
      expect(errors).toHaveLength(1);
      expect(errors[0]?._tag === "error" ? errors[0].message : "").toContain("server.port");
      expect(errors[0]?._tag === "error" ? errors[0].message : "").toContain("next start");
      expect(run.renders).toHaveLength(1);
    }),
  );

  it.effect("an editor-class change is reported once and never sent", () =>
    Effect.gen(function* () {
      const frame = encodeFrame(
        configurationOf([{ key: "preview.combine", value: true, source: "setup:preview.combine" }]),
      );
      const run = yield* runSession({
        chunks: [[encodeFrame(documentOf("# hello\n"))], [frame], [frame], [frame]],
      });

      const errors = run.written.filter((message) => message._tag === "error");
      expect(errors).toHaveLength(1);
      expect(errors[0]?._tag === "error" ? errors[0].message : "").toContain("preview.combine");
      expect(errors[0]?._tag === "error" ? errors[0].message : "").toContain("next start");
      expect(run.renders).toHaveLength(1);
    }),
  );

  it.effect("a render change re-renders exactly once from the retained text", () =>
    Effect.gen(function* () {
      const run = yield* runSession({
        chunks: [
          [encodeFrame(documentOf("# hello\n"))],
          [
            encodeFrame(
              configurationOf([
                {
                  key: "render.markdown_it",
                  value: { breaks: true },
                  source: "setup:render.markdown_it",
                },
              ]),
            ),
          ],
        ],
      });

      expect(run.renders).toEqual(["# hello\n", "# hello\n"]);
      expect(run.renderOptions[1]?.breaks).toBe(true);
      expect(run.pushes).toHaveLength(2);
    }),
  );

  it.effect("a rejected value answers one config error with the four fields", () =>
    Effect.gen(function* () {
      const run = yield* runSession({
        chunks: [
          [encodeFrame(documentOf("# hello\n"))],
          [
            encodeFrame(
              configurationOf([
                { key: "scroll.mode", value: "diagonal", source: "setup:scroll.mode" },
              ]),
            ),
          ],
          [encodeFrame(documentOf("# after\n"))],
        ],
      });

      const errors = run.written.filter((message) => message._tag === "error");
      expect(errors).toHaveLength(1);
      expect(errors[0]?._tag === "error" ? errors[0].stage : null).toBe("config");
      expect(errors[0]?._tag === "error" ? errors[0].message : "").toBe(
        "invalid configuration: key scroll.mode, expected middle|top|relative, received diagonal, source setup:scroll.mode",
      );
      expect(run.renders).toHaveLength(2);
    }),
  );
});
