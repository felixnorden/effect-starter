import { Effect, type Stream } from "effect";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname } from "node:path";

import { coalesce, type CoalesceEvent, type SourceSnapshot } from "../coalesce.ts";
import { watchDirectory, WatchError } from "../watch.ts";

export const hashSource = (source: string): string =>
  createHash("sha256").update(source).digest("hex");

const reasonOf = (cause: unknown): "missing" | "permission" | "other" => {
  const code =
    typeof cause === "object" && cause !== null && "code" in cause ? String(cause.code) : "";
  if (code === "ENOENT") return "missing";
  if (code === "EACCES" || code === "EPERM") return "permission";
  return "other";
};

/** The file source: always the target file, never the event path. */
export const readSnapshot = (file: string): Effect.Effect<SourceSnapshot, WatchError> =>
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

export type FileSource = {
  readonly events: Stream.Stream<CoalesceEvent, WatchError>;
  readonly read: () => Effect.Effect<SourceSnapshot, WatchError>;
  readonly localRoot: string;
};

/** The standalone command's one producer: watch the directory and read the file. */
export const fileSource = (file: string): FileSource => {
  const read = () => readSnapshot(file);
  return {
    events: coalesce(watchDirectory(dirname(file)), read),
    read,
    localRoot: dirname(file),
  };
};
