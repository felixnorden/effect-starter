#!/usr/bin/env bun
/**
 * A counting stub for the recorded refresh run. It is never imported by product
 * code. It reads one JSON frame per line from standard input, appends one record
 * per document frame (`count` plus a sha256 digest of the text), answers exactly
 * one `ready` after the first document, and appends one close record when its
 * input closes. It ignores its argument vector and exits 0.
 */
import { appendFileSync } from "node:fs";
import { createHash } from "node:crypto";

import { encodeFrame } from "@mdv/core/editor-frame";
import { EDITOR_PROTOCOL_VERSION } from "@mdv/core/editor-protocol";

const recordPath = process.env.MDV_STUB_RECORD ?? "";
const url = "http://127.0.0.1:45999/";

let count = 0;
let readySent = false;

const record = (value: unknown): void => {
  if (recordPath !== "") {
    appendFileSync(recordPath, `${JSON.stringify(value)}\n`);
  }
};

const handle = (line: string): void => {
  const trimmed = line.trim();
  if (trimmed === "") return;

  let message: { readonly _tag?: string; readonly text?: string };
  try {
    message = JSON.parse(trimmed) as { readonly _tag?: string; readonly text?: string };
  } catch {
    return;
  }

  if (message._tag !== "document") return;

  count += 1;
  const digest = createHash("sha256")
    .update(message.text ?? "", "utf8")
    .digest("hex");
  record({ count, digest });

  if (!readySent) {
    readySent = true;
    process.stdout.write(
      encodeFrame({
        _tag: "ready",
        editorProtocolVersion: EDITOR_PROTOCOL_VERSION,
        sessionId: "stub",
        url,
      }),
    );
  }
};

const reader = Bun.stdin.stream().getReader();
const decoder = new TextDecoder();
let buffered = "";

for (;;) {
  const { done, value } = await reader.read();
  if (done) break;
  buffered += decoder.decode(value, { stream: true });
  let index = buffered.indexOf("\n");
  while (index >= 0) {
    handle(buffered.slice(0, index));
    buffered = buffered.slice(index + 1);
    index = buffered.indexOf("\n");
  }
}
if (buffered.trim() !== "") handle(buffered);

record({ closed: true, count });
process.exit(0);
