// @effect-diagnostics unstableApiUsage:off
// @effect-diagnostics asyncFunction:off
// @effect-diagnostics strictEffectProvide:off
import { decodeServerMessage, PROTOCOL_VERSION, type ServerMessage } from "@mdv/core/protocol";
import { NodeHttpServer } from "@effect/platform-node";
import { Effect, Result, Stream } from "effect";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path, { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { Client } from "./client-hub.ts";
import { handleClientFrame, resolveStaticPath, startServer } from "./server.ts";

type SpyClient = Client & {
  readonly frames: readonly string[];
  readonly closes: number;
};

const spyClient = (): SpyClient => {
  const frames: string[] = [];
  let closes = 0;
  return {
    frames,
    get closes() {
      return closes;
    },
    send: (frame) => frames.push(frame),
    close: () => {
      closes += 1;
    },
  };
};

const decodedFrames = (client: SpyClient): ServerMessage[] =>
  client.frames.map((frame) => {
    const decoded = decodeServerMessage(frame);
    if (!Result.isSuccess(decoded)) throw new Error("server sent an invalid frame");
    return decoded.success;
  });

const snapshotMessage: ServerMessage = {
  _tag: "snapshot",
  seq: 1,
  title: "Kitchen Sink",
  blocks: [],
};

const handle = (client: SpyClient, frame: string, snapshot: ServerMessage | null = null) =>
  Effect.runPromise(
    handleClientFrame(
      {
        hub: undefined as never,
        client,
        title: "Kitchen Sink",
        fileName: "kitchen-sink.md",
        currentSnapshot: Effect.succeed(snapshot),
      },
      frame,
    ),
  );

describe("handleClientFrame", () => {
  it("a hello with the current version answers ready", async () => {
    const client = spyClient();

    await handle(client, `{"_tag":"hello","protocolVersion":${PROTOCOL_VERSION}}`);

    const [message] = decodedFrames(client);
    expect(message).toMatchObject({
      _tag: "ready",
      protocolVersion: PROTOCOL_VERSION,
      title: "Kitchen Sink",
      fileName: "kitchen-sink.md",
    });
  });

  it("a hello with a different version answers error naming both versions, then closes", async () => {
    const client = spyClient();

    await handle(client, `{"_tag":"hello","protocolVersion":99}`);

    const [message] = decodedFrames(client);
    expect(message?._tag).toBe("error");
    expect(message?._tag === "error" ? message.message : "").toContain("99");
    expect(message?._tag === "error" ? message.message : "").toContain("1");
    expect(client.closes).toBe(1);
    expect(client.frames).toHaveLength(1);
  });

  it("an undecodable frame answers error with stage protocol", async () => {
    const client = spyClient();

    await handle(client, `{"_tag":"nope"}`);

    const [message] = decodedFrames(client);
    expect(message?._tag === "error" ? message.stage : null).toBe("protocol");
    expect(client.closes).toBe(0);
  });

  it("a requestSnapshot answers with the current snapshot", async () => {
    const client = spyClient();

    await handle(client, `{"_tag":"requestSnapshot"}`, snapshotMessage);

    expect(decodedFrames(client)[0]).toEqual(snapshotMessage);
  });

  it("an ack is readiness only and answers nothing", async () => {
    const client = spyClient();

    await handle(client, `{"_tag":"ack"}`);

    expect(client.frames).toEqual([]);
  });

  it("rejects a traversal path for the page assets", () => {
    const root = path.resolve("/tmp/client");

    expect(resolveStaticPath(root, "../secret")).toBeNull();
    expect(resolveStaticPath(root, "%2e%2e%2fsecret")).toBeNull();
  });

  it("resolves a nested asset", () => {
    const root = path.resolve("/tmp/client");

    expect(resolveStaticPath(root, "assets/index-abc.js")).toBe(
      path.resolve(root, "assets/index-abc.js"),
    );
  });

  it("resolves the page root", () => {
    const root = path.resolve("/tmp/client");

    expect(resolveStaticPath(root, "/")).toBe(path.resolve(root, "index.html"));
    expect(resolveStaticPath(root, "/index.html")).toBe(path.resolve(root, "index.html"));
  });
});

describe("startServer asset routes", () => {
  const roots: string[] = [];

  const makeRoot = (): string => {
    const dir = mkdtempSync(join(tmpdir(), "preview-server-"));
    roots.push(dir);
    return dir;
  };

  afterEach(() => {
    for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  const withServer = <A>(
    imageRoot: string | null,
    use: (url: string) => Effect.Effect<A>,
    localRoot?: string | null,
  ): Promise<A> => {
    const clientDir = makeRoot();
    writeFileSync(join(clientDir, "index.html"), "page");
    const boundLocalRoot = localRoot === undefined ? makeRoot() : localRoot;
    if (boundLocalRoot !== null) {
      writeFileSync(join(boundLocalRoot, "pixel.png"), "png");
    }
    return Effect.runPromise(
      Effect.gen(function* () {
        const handle = yield* startServer({
          clientDir,
          localRoot: boundLocalRoot,
          imageRoot,
          fileName: "a.md",
          title: null,
          currentSnapshot: Effect.succeed(null),
          updates: Stream.empty,
        });
        return yield* use(handle.url);
      }).pipe(Effect.provide(NodeHttpServer.layerTest)),
    );
  };

  it("serves an image-root reference from the configured root", async () => {
    const imageRoot = makeRoot();
    writeFileSync(join(imageRoot, "pixel.png"), "png");

    const response = await withServer(imageRoot, (url) =>
      Effect.promise(() => fetch(new URL("image-root/pixel.png", url))),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("answers 404 when no root is bound and never falls back to the local root", async () => {
    const response = await withServer(null, (url) =>
      Effect.promise(() => fetch(new URL("image-root/pixel.png", url))),
    );

    expect(response.status).toBe(404);
    expect(await response.text()).toBe("Not found");
  });

  it("answers 404 for /local/ when an editor session has no local root", async () => {
    const response = await withServer(
      null,
      (url) => Effect.promise(() => fetch(new URL("local/anything.md", url))),
      null,
    );

    expect(response.status).toBe(404);
  });

  it("answers 404 for an unknown root segment", async () => {
    const response = await withServer(makeRoot(), (url) =>
      Effect.promise(() => fetch(new URL("image-root-other/pixel.png", url))),
    );

    expect(response.status).toBe(404);
  });
});
