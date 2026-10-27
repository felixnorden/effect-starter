#!/usr/bin/env bun
/**
 * Shared process helpers for the editor evidence scripts. Not a command.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const editorCommand = (logFile: string): readonly string[] => [
  "bun",
  path.join(root, "packages/app/src/main.ts"),
  "editor",
  "--log-file",
  logFile,
];

export type EditorProcess = EditorProcess;

export const spawnEditor = (logFile: string) =>
  Bun.spawn({
    cmd: [...editorCommand(logFile)],
    cwd: root,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });

export const raceTimeout = <T>(promise: Promise<T>, ms: number, label: string): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms} ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
};

export const lineReader = (stream: ReadableStream<Uint8Array>) => {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  return {
    async next(ms = 20_000): Promise<string | null> {
      while (true) {
        const index = buffer.indexOf("\n");
        if (index >= 0) {
          const line = buffer.slice(0, index);
          buffer = buffer.slice(index + 1);
          return line;
        }
        const chunk = await raceTimeout(reader.read(), ms, "frame read");
        if (chunk.done) return buffer === "" ? null : buffer;
        buffer += decoder.decode(chunk.value, { stream: true });
      }
    },
    cancel(): void {
      void reader.cancel();
    },
  };
};

export const writeRaw = (proc: EditorProcess, data: string | Uint8Array): void => {
  try {
    const result = proc.stdin.write(data);
    if (result instanceof Promise) void result.catch(() => undefined);
  } catch {
    // The process may have closed its stdin.
  }
  try {
    void proc.stdin.flush();
  } catch {
    // The sink is gone.
  }
};

export const writeLine = (proc: EditorProcess, text: string): void => {
  writeRaw(proc, text);
};

export const waitForFrame = async <T>(
  lines: ReturnType<typeof lineReader>,
  predicate: (value: T) => boolean,
  ms = 20_000,
): Promise<T> => {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const line = await lines.next(Math.max(1, deadline - Date.now()));
    if (line === null) break;
    if (line.trim() === "") continue;
    let value: T;
    try {
      value = JSON.parse(line) as T;
    } catch {
      continue;
    }
    if (predicate(value)) return value;
  }
  throw new Error("no matching frame");
};

export type ReadyFrame = {
  readonly _tag: "ready";
  readonly url: string;
  readonly sessionId: string;
};

export const waitForBind = async (logFile: string, ms = 5000): Promise<number> => {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    try {
      const text = readFileSync(logFile, "utf8");
      const match = text.match(/bind epochMs=(\d+)/);
      if (match?.[1] !== undefined) return Number(match[1]);
    } catch {
      // The server has not created the file yet.
    }
    await Bun.sleep(10);
  }
  throw new Error(`no bind line in ${logFile}`);
};

export const waitExit = (proc: EditorProcess, ms: number): Promise<number> =>
  raceTimeout(proc.exited, ms, "process exit");

export const kill = async (proc: EditorProcess): Promise<void> => {
  try {
    proc.kill();
  } catch {
    // Already gone.
  }
  await Promise.race([proc.exited, Bun.sleep(1000)]);
};
