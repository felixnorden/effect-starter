// @effect-diagnostics asyncFunction:off
// @effect-diagnostics runEffectInsideEffect:off
import {
  decodeClientMessage,
  encodeServerMessage,
  PROTOCOL_VERSION,
  type ServerMessage,
} from "@mdv/core/protocol";
import { Effect, Fiber, Result, Stream } from "effect";
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
const rawPathOf = (request: Request): string => {
  const originEnd = request.url.indexOf("://");
  const pathStart = request.url.indexOf("/", originEnd === -1 ? 0 : originEnd + 3);
  return pathStart === -1 ? "/" : request.url.slice(pathStart);
};

export type ServerOptions = {
  readonly port: number;
  readonly clientDir: string;
  /** The source file's directory: the sole allowed root for `/local/*`. */
  readonly localRoot: string;
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

const serveStatic = async (clientDir: string, pathname: string): Promise<Response> => {
  const filePath = resolveStaticPath(clientDir, pathname);
  if (filePath === null) return new Response("Forbidden", { status: 403 });

  const file = Bun.file(filePath);
  if (!(await file.exists())) return new Response("Not found", { status: 404 });
  return new Response(file);
};

/**
 * One loopback origin: static page assets, the `/ws` upgrade, and the update
 * fan-out. Bun-only code stays in this function.
 */
export const startServer = (options: ServerOptions): Effect.Effect<ServerHandle> =>
  Effect.gen(function* () {
    const hub = createClientHub();
    const frameDeps = {
      hub,
      fileName: options.fileName,
      title: options.title,
      currentSnapshot: options.currentSnapshot,
    };

    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: options.port,
      fetch: async (request, bunServer) => {
        const rawPath = rawPathOf(request);

        if (rawPath === "/ws") {
          if (bunServer.upgrade(request)) return undefined;
          return new Response("upgrade failed", { status: 400 });
        }

        if (rawPath.startsWith("/local/")) {
          const resolved = await Effect.runPromise(
            Effect.result(resolveAsset(options.localRoot, rawPath)),
          );
          if (Result.isFailure(resolved)) {
            return new Response(resolved.failure.message, {
              status: resolved.failure.status,
            });
          }
          return localAssetResponse(resolved.success);
        }

        return serveStatic(options.clientDir, rawPath);
      },
      websocket: {
        sendPings: true,
        idleTimeout: 120,
        open: (socket) => {
          hub.add(socket as unknown as Client);
        },
        message: (socket, message) => {
          void Effect.runPromise(
            handleClientFrame(
              { ...frameDeps, client: socket as unknown as Client },
              String(message),
            ),
          );
        },
        close: (socket) => {
          hub.remove(socket as unknown as Client);
        },
      },
    });

    const updatesFiber = yield* Effect.forkChild(
      Stream.runForEach(options.updates, (message) =>
        Effect.sync(() => hub.broadcast(encodeServerMessage(message))),
      ),
    );

    return {
      url: `http://127.0.0.1:${server.port}/`,
      broadcast: (message) => hub.broadcast(encodeServerMessage(message)),
      close: Effect.sync(() => {
        void server.stop(true);
        hub.closeAll();
      }).pipe(Effect.andThen(Fiber.interrupt(updatesFiber))),
    };
  });
