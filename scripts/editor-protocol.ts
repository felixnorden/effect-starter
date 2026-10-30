#!/usr/bin/env bun
/**
 * Prove the editor protocol document is complete: a second adapter, written
 * from the document alone, starts a real server, opens the address, and sends
 * one cursor update. A page observer sees the session and the resolved cursor.
 */
import {
  startFrames,
  cursorFrame,
  rejectedFrame,
  hello,
  ack,
} from "../packages/editor/tests/protocol-adapter/adapter.ts";

const root = new URL("..", import.meta.url).pathname;
const TIMEOUT_MS = 20_000;

const failure = (message: string): never => {
  console.error(`FAIL editor:protocol: ${message}`);
  process.exit(1);
};

const withTimeout = async <T>(work: Promise<T>, label: string): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out`)), TIMEOUT_MS);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
};

class Lines {
  private buffer = "";
  private readonly decoder = new TextDecoder();
  private readonly reader: ReadableStreamDefaultReader<Uint8Array>;
  private readonly pending: string[] = [];
  private readonly waiting: ((line: string) => void)[] = [];

  constructor(stream: ReadableStream<Uint8Array>) {
    this.reader = stream.getReader();
  }

  private push(text: string): void {
    this.buffer += text;
    const parts = this.buffer.split("\n");
    this.buffer = parts.pop() ?? "";
    for (const line of parts) {
      const waiter = this.waiting.shift();
      if (waiter === undefined) this.pending.push(line);
      else waiter(line);
    }
  }

  async start(): Promise<void> {
    for (;;) {
      const { done, value } = await this.reader.read();
      if (done) return;
      this.push(this.decoder.decode(value, { stream: true }));
    }
  }

  next(): Promise<string> {
    const line = this.pending.shift();
    if (line !== undefined) return Promise.resolve(line);
    return new Promise((resolve) => this.waiting.push(resolve));
  }
}

const startServer = () => {
  const proc = Bun.spawn(
    [
      "bun",
      `${root}packages/app/src/main.ts`,
      "editor",
      "--log-file",
      "/tmp/mdv-protocol-adapter.log",
    ],
    { cwd: root, stdin: "pipe", stdout: "pipe", stderr: "pipe" },
  );
  const lines = new Lines(proc.stdout);
  void lines.start();
  return { proc, lines };
};

const send = (proc: ReturnType<typeof startServer>["proc"], frames: readonly Uint8Array[]) => {
  for (const frame of frames) proc.stdin.write(frame);
  return proc.stdin.flush();
};

const stop = (proc: ReturnType<typeof startServer>["proc"]) => {
  try {
    proc.stdin.end();
  } catch {
    // Already gone.
  }
  setTimeout(() => proc.kill(), 500);
};

const decode = (line: string): Record<string, unknown> => {
  try {
    return JSON.parse(line) as Record<string, unknown>;
  } catch {
    return failure(`the server wrote a line that is not JSON: ${line.slice(0, 120)}`);
  }
};

const runAdapter = async () => {
  const { proc, lines } = startServer();
  await send(proc, startFrames());
  const ready = decode(await withTimeout(lines.next(), "ready"));
  if (ready._tag !== "ready" || typeof ready.url !== "string") {
    return failure(`expected ready with a URL, received ${JSON.stringify(ready)}`);
  }
  const url = ready.url;
  console.log(`opened ${url}`);

  const ws = new WebSocket(`${url.replace(/^http/, "ws").replace(/\/$/, "")}/ws`);
  const seen: Record<string, unknown>[] = [];
  await withTimeout(
    new Promise<void>((resolve, reject) => {
      ws.onerror = () => reject(new Error("the page socket failed"));
      ws.onopen = () => {
        ws.send(hello());
        ws.send(ack());
      };
      ws.onmessage = (event) => {
        const message = decode(String(event.data));
        seen.push(message);
        if (message._tag === "session" && message._tag !== "cursor") {
          void send(proc, [cursorFrame()]);
        }
        if (message._tag === "cursor") resolve();
      };
    }),
    "the page cursor",
  );
  ws.close();
  stop(proc);

  const session = seen.find((entry) => entry._tag === "session");
  const cursor = seen.find((entry) => entry._tag === "cursor");
  if (session === undefined) return failure("the page never received a session member");
  if (cursor === undefined) return failure("the page never received a cursor member");
  for (const field of ["blockId", "line", "fraction", "seq"]) {
    if (cursor[field] === undefined) return failure(`the cursor member has no ${field}`);
  }
  console.log(
    `session ${String(session.fileName)}; cursor block=${String(cursor.blockId)} line=${String(cursor.line)} fraction=${String(cursor.fraction)} seq=${String(cursor.seq)}`,
  );
  return null;
};

const runRejected = async () => {
  const { proc, lines } = startServer();
  await send(proc, [rejectedFrame()]);
  const error = decode(await withTimeout(lines.next(), "the config error"));
  stop(proc);
  if (error._tag !== "error" || error.stage !== "config") {
    return failure(`expected one config-stage error, received ${JSON.stringify(error)}`);
  }
  const message = String(error.message);
  for (const field of ["preview.width", "string", "received", "setup:preview.width"]) {
    if (!message.includes(field)) return failure(`the config error omits ${field}: ${message}`);
  }
  console.log(`config error: ${message}`);
  return null;
};

await runAdapter();
await runRejected();
console.log("OK editor:protocol");
