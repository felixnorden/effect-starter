import { encodeFrame } from "@mdv/core/editor-frame";
import type { ServerToEditorMessage } from "@mdv/core/editor-protocol";
import { Effect, Stream } from "effect";

/**
 * Bun-only. Standard input is the frame source and standard output is the frame
 * sink; nothing a test imports may reach this module.
 */
export const stdinChunks: Stream.Stream<Uint8Array> = Stream.fromReadableStream({
  evaluate: () => Bun.stdin.stream(),
  onError: (cause) => cause,
}).pipe(Stream.orDie);

const stdout = Bun.stdout.writer();

/** One writer: encode one message, one frame, one flush. */
export const writeStdout = (message: ServerToEditorMessage): Effect.Effect<void> =>
  Effect.sync(() => {
    void stdout.write(encodeFrame(message));
    // The write is queued; a backed-up pipe may return a promise here.
    void stdout.flush();
  });
