// @effect-diagnostics strictEffectProvide:off
import {
  CodeHighlighting,
  defaultRenderOptions,
  diffBlocks,
  DocumentSession,
  encodeServerMessage,
  Renderer,
  type DocumentModel,
  type PatchMessage,
  type SessionState,
} from "@mdv/core";
import { Effect, Layer } from "effect";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

const FIXTURES = [
  "fixtures/kitchen-sink.md",
  "fixtures/generated/100kb.md",
  "fixtures/generated/1mb.md",
  "fixtures/render-fidelity/math.md",
] as const;

const RUNS = 5;

const layer = Layer.merge(
  Renderer.layer.pipe(Layer.provide(CodeHighlighting.layer)),
  DocumentSession.layer,
);

const median = (values: readonly number[]): number => {
  const sorted = [...values].toSorted((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
};

const bytesOf = (value: unknown): number => Buffer.byteLength(JSON.stringify(value), "utf8");

const formatBytes = (bytes: number): string => `${(bytes / 1024).toFixed(1)} KB`;

const formatMs = (value: number): string => value.toFixed(1);

const codeBlocks = (document: DocumentModel): number =>
  document.blocks.filter((block) => block.kind === "code").length;

/** Append to the first paragraph's first line, so exactly one block changes. */
const editOneParagraph = (source: string, document: DocumentModel): string => {
  const paragraph = document.blocks.find((block) => block.kind === "paragraph");
  if (paragraph === undefined) return source;
  const lines = source.split("\n");
  const index = paragraph.range.startLine - 1;
  lines[index] = `${lines[index] ?? ""} edited`;
  return lines.join("\n");
};

const identityOf = (state: SessionState) =>
  state.blocks.map((block) => ({ id: block.id, hash: block.hash }));

const isPatchWithOrder = (patch: PatchMessage): boolean => "order" in patch;

const program = Effect.gen(function* () {
  const renderer = yield* Renderer;
  const session = yield* DocumentSession;

  console.log(
    [
      "fixture".padEnd(28),
      "median ms".padStart(10),
      "json".padStart(11),
      "snapshot".padStart(11),
      "patch".padStart(9),
      "diff ms".padStart(8),
      "order".padStart(6),
      "id kept".padStart(8),
      "blocks".padStart(8),
      "code".padStart(6),
    ].join("  "),
  );

  for (const fixture of FIXTURES) {
    const source = readFileSync(path.join(root, fixture), "utf8");
    const timings: number[] = [];
    let document: DocumentModel | undefined;

    for (let run = 0; run < RUNS; run += 1) {
      const start = performance.now();
      document = yield* renderer.render(source, defaultRenderOptions);
      timings.push(performance.now() - start);
    }

    if (document === undefined) continue;

    const snapshot = yield* session.apply(null, document);
    const editedSource = editOneParagraph(source, document);
    const edited = yield* renderer.render(editedSource, defaultRenderOptions);

    const diffStart = performance.now();
    diffBlocks(
      identityOf(snapshot.state),
      edited.blocks.map((block) => block.hash),
    );
    const diffMs = performance.now() - diffStart;

    const patched = yield* session.apply(snapshot.state, edited);
    if (patched.update._tag !== "patch") continue;
    const patch = patched.update;

    const snapshotIds = new Set(snapshot.state.blocks.map((block) => block.id));
    const idKept = patch.upserts.length === 1 && snapshotIds.has(patch.upserts[0]!.id);

    console.log(
      [
        fixture.padEnd(28),
        formatMs(median(timings)).padStart(10),
        formatBytes(bytesOf(document)).padStart(11),
        formatBytes(Buffer.byteLength(encodeServerMessage(snapshot.update))).padStart(11),
        formatBytes(Buffer.byteLength(encodeServerMessage(patch))).padStart(9),
        formatMs(diffMs).padStart(8),
        (isPatchWithOrder(patch) ? "yes" : "no").padStart(6),
        (idKept ? "yes" : "no").padStart(8),
        String(document.blocks.length).padStart(8),
        String(codeBlocks(document)).padStart(6),
      ].join("  "),
    );

    if (fixture.endsWith("1mb.md")) {
      const bun = (globalThis as { Bun?: { gc?: (force: boolean) => void } }).Bun;
      bun?.gc?.(true);
      const rss = process.memoryUsage().rss / 1024 / 1024;
      console.log(`RSS after 1 MB render: ${rss.toFixed(1)} MB`);
    }
  }
});

await Effect.runPromise(program.pipe(Effect.provide(layer)));
