// @effect-diagnostics unstableApiUsage:off
// @effect-diagnostics asyncFunction:off
// @effect-diagnostics runEffectInsideEffect:off
import {
  decodeClientMessage,
  encodeServerMessage,
  PROTOCOL_VERSION,
  type ServerMessage,
} from "@mdv/core/protocol";
import { Effect, Exit, Fiber, Queue, Result, Scope, Stream } from "effect";
import * as FileSystem from "effect/FileSystem";
import * as HttpServer from "effect/http/HttpServer";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import * as HttpPlatform from "effect/http/HttpPlatform";
import * as Socket from "effect/socket/Socket";
import path from "node:path";

import { localAssetResponse, resolveAsset } from "./assets.ts";
import { createClientHub, type Client, type ClientHub } from "./client-hub.ts";

export type ClientFrameDeps = {
  readonly hub: ClientHub;
  readonly client: Client;
  readonly title: string | null;
  readonly fileName: string;
  readonly currentSnapshot: Effect.Effect<ServerMessage | null>;
};

/**
 * The frame dispatch is a pure function over an abstract `Client` so the Node
 * test pool can exercise it without a socket.
 */
export const handleClientFrame = (deps: ClientFrameDeps, frame: string): Effect.Effect<void> =>
  Effect.gen(function* () {
    const decoded = decodeClientMessage(frame);

    if (Result.isFailure(decoded)) {
      deps.client.send(
        encodeServerMessage({
          _tag: "error",
          stage: "protocol",
          message: "invalid frame",
        }),
      );
      return;
    }

    const message = decoded.success;

    if (message._tag === "hello") {
      if (message.protocolVersion !== PROTOCOL_VERSION) {
        deps.client.send(
          encodeServerMessage({
            _tag: "error",
            stage: "protocol",
            message: `protocol version mismatch: client ${message.protocolVersion}, server ${PROTOCOL_VERSION}`,
          }),
        );
        deps.client.close();
        return;
      }

      deps.client.send(
        encodeServerMessage({
          _tag: "ready",
          protocolVersion: PROTOCOL_VERSION,
          title: deps.title,
          fileName: deps.fileName,
        }),
      );
      return;
    }

    if (message._tag === "ack") return;

    const snapshot = yield* deps.currentSnapshot;
    if (snapshot !== null) deps.client.send(encodeServerMessage(snapshot));
  });

/** Containment: no `..` segment, no backslash escape, no path outside the root. */
export const resolveStaticPath = (root: string, urlPath: string): string | null => {
  const withoutQuery = urlPath.split("?")[0]?.split("#")[0] ?? "/";

  let decoded: string;
  try {
    decoded = decodeURIComponent(withoutQuery);
  } catch {
    return null;
  }

  const segments = decoded.replaceAll("\\", "/").split("/");
  if (segments.some((segment) => segment === "..")) return null;

  const relative = segments.filter((segment) => segment !== "" && segment !== ".").join("/");
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, relative === "" ? "index.html" : relative);

  if (resolved !== resolvedRoot && !resolved.startsWith(`${resolvedRoot}${path.sep}`)) {
    return null;
  }
  return resolved;
};

/** The raw request path, before the URL parser folds `..` or decodes `%2e`. */
const rawPathOf = (url: string): string => url.split("?")[0] ?? "/";

export type ServerOptions = {
  readonly clientDir: string;
  /** The source file's directory: the sole allowed root for `/local/*`. */
  readonly localRoot: string;
  /** The one configured image root; `null` means the route exists but answers 404. */
  readonly imageRoot: string | null;
  readonly fileName: string;
  readonly title: string | null;
  readonly currentSnapshot: Effect.Effect<ServerMessage | null>;
  readonly updates: Stream.Stream<ServerMessage>;
};

export type ServerHandle = {
  readonly url: string;
  readonly broadcast: (message: ServerMessage) => void;
  readonly close: Effect.Effect<void>;
};

const notFound = (): HttpServerResponse.HttpServerResponse =>
  HttpServerResponse.text("Not found", { status: 404 });

/** One route per allowed root: the prefix names the root, the resolver guards it. */
const serveFromRoot = (
  root: string,
  rawPath: string,
  prefix: string,
): Effect.Effect<
  HttpServerResponse.HttpServerResponse,
  never,
  HttpPlatform.HttpPlatform | FileSystem.FileSystem
> =>
  Effect.gen(function* () {
    const resolved = yield* Effect.result(resolveAsset(root, rawPath, prefix));
    if (Result.isFailure(resolved)) {
      return HttpServerResponse.text(resolved.failure.message, {
        status: resolved.failure.status,
      });
    }
    return yield* localAssetResponse(resolved.success).pipe(Effect.orElseSucceed(() => notFound()));
  });

const serveStatic = (
  clientDir: string,
  pathname: string,
): Effect.Effect<
  HttpServerResponse.HttpServerResponse,
  never,
  HttpPlatform.HttpPlatform | FileSystem.FileSystem
> =>
  Effect.gen(function* () {
    const filePath = resolveStaticPath(clientDir, pathname);
    if (filePath === null) return HttpServerResponse.text("Forbidden", { status: 403 });

    const fs = yield* FileSystem.FileSystem;
    const exists = yield* fs.exists(filePath).pipe(Effect.orElseSucceed(() => false));
    if (!exists) return notFound();
    return yield* HttpServerResponse.file(filePath).pipe(Effect.orElseSucceed(() => notFound()));
  });

/**
 * One upgraded connection: writes are queued so the frame dispatch stays
 * synchronous, and the writer fiber drains the queue in order.
 */
const serveWebSocket = (
  request: HttpServerRequest.HttpServerRequest,
  hub: ClientHub,
  frameDeps: Omit<ClientFrameDeps, "client">,
): Effect.Effect<HttpServerResponse.HttpServerResponse, never, Scope.Scope> =>
  Effect.gen(function* () {
    const upgraded = yield* Effect.result(request.upgrade);
    if (Result.isFailure(upgraded)) {
      return HttpServerResponse.text("upgrade failed", { status: 400 });
    }

    const socket = upgraded.success;
    const outgoing = yield* Queue.unbounded<string | Socket.CloseEvent>();
    const client: Client = {
      send: (frame) => {
        Queue.offerUnsafe(outgoing, frame);
      },
      close: () => {
        Queue.offerUnsafe(outgoing, new Socket.CloseEvent(1000, ""));
      },
    };

    hub.add(client);
    const writerResult = yield* Effect.result(socket.writer);
    if (Result.isFailure(writerResult)) {
      return HttpServerResponse.text("upgrade failed", { status: 400 });
    }
    const writer = writerResult.success;
    yield* Effect.forkScoped(
      Stream.fromQueue(outgoing).pipe(
        Stream.runForEach((frame) => writer.write(frame).pipe(Effect.ignore)),
        Effect.ignore,
      ),
    );

    const readerResult = yield* Effect.result(socket.reader);
    if (Result.isFailure(readerResult)) {
      return HttpServerResponse.text("upgrade failed", { status: 400 });
    }
    yield* readerResult.success.pull.pipe(
      Effect.flatMap((frames) =>
        Effect.forEach(
          frames,
          (frame) => handleClientFrame({ ...frameDeps, client }, String(frame)),
          { discard: true },
        ),
      ),
      Effect.forever,
      Effect.ignore,
      Effect.ensuring(
        Effect.gen(function* () {
          hub.remove(client);
          yield* Queue.shutdown(outgoing);
        }),
      ),
    );

    return HttpServerResponse.empty({ status: 101 });
  });

/**
 * One loopback origin: static page assets, the `/ws` upgrade, and the update
 * fan-out. The transport comes from the platform layer chosen at the
 * entrypoint, so the same app runs under Bun and under the Node test server.
 */
export const startServer = (
  options: ServerOptions,
): Effect.Effect<
  ServerHandle,
  never,
  HttpServer.HttpServer | HttpPlatform.HttpPlatform | FileSystem.FileSystem
> =>
  Effect.gen(function* () {
    const hub = createClientHub();
    const frameDeps = {
      hub,
      fileName: options.fileName,
      title: options.title,
      currentSnapshot: options.currentSnapshot,
    };

    const app = Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const rawPath = rawPathOf(request.url);

      if (rawPath === "/ws") return yield* serveWebSocket(request, hub, frameDeps);
      if (rawPath.startsWith("/local/")) {
        return yield* serveFromRoot(options.localRoot, rawPath, "/local/");
      }
      if (rawPath.startsWith("/image-root/")) {
        if (options.imageRoot === null) return notFound();
        return yield* serveFromRoot(options.imageRoot, rawPath, "/image-root/");
      }

      return yield* serveStatic(options.clientDir, rawPath);
    });

    const serveScope = yield* Scope.make();
    yield* (yield* HttpServer.HttpServer)
      .serve(app)
      .pipe(Effect.provideService(Scope.Scope, serveScope));

    const updatesFiber = yield* Effect.forkChild(
      Stream.runForEach(options.updates, (message) =>
        Effect.sync(() => hub.broadcast(encodeServerMessage(message))),
      ),
    );

    return {
      url: yield* HttpServer.addressFormattedWith((address) => Effect.succeed(address)),
      broadcast: (message) => hub.broadcast(encodeServerMessage(message)),
      close: Effect.sync(() => hub.closeAll()).pipe(
        Effect.andThen(Scope.close(serveScope, Exit.void)),
        Effect.andThen(Fiber.interrupt(updatesFiber)),
      ),
    };
  });
