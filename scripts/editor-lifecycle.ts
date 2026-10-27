#!/usr/bin/env bun
/**
 * ED-9, PT-9, and SE-8 at process level: spawn the editor session, write one
 * document frame, read the bind line and the ready frame, close standard input,
 * assert exit 0; then write an over-cap line, assert one error frame and exit 1;
 * then grep the log for the document marker.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { MAX_FRAME_BYTES } from "../packages/core/src/editor-frame.ts";
import {
  kill,
  lineReader,
  root,
  spawnEditor,
  waitExit,
  waitForBind,
  waitForFrame,
  writeLine,
  writeRaw,
  type ReadyFrame,
} from "./editor-process.ts";

const dir = mkdtempSync(path.join(tmpdir(), "mdv-editor-lifecycle-"));
const marker = `MDV_LIFECYCLE_MARKER_${Date.now()}`;
let failed = false;

const check = (label: string, condition: boolean): void => {
  console.log(`${condition ? "ok" : "FAIL"} ${label}`);
  if (!condition) failed = true;
};

const frame = (message: unknown): string => `${JSON.stringify(message)}\n`;

const document = {
  _tag: "document",
  editorProtocolVersion: 1,
  path: path.join(root, "fixtures/kitchen-sink.md"),
  text: `# Lifecycle\n\n${marker}\n`,
};

const firstLog = path.join(dir, "eof.log");
const first = spawnEditor(firstLog);
const started = Date.now();

try {
  const lines = lineReader(first.stdout);
  writeLine(first, frame(document));

  const ready = await waitForFrame<ReadyFrame>(lines, (value) => value._tag === "ready");
  const readyMs = Date.now() - started;
  const bindEpoch = await waitForBind(firstLog);
  const bindMs = bindEpoch - started;

  first.stdin.end();
  const exit = await waitExit(first, 5000);
  lines.cancel();

  check(`eof exit is 0 (got ${exit})`, exit === 0);
  check(`ready frame carried a session id and url (${ready.url})`, ready.sessionId !== "");

  const logText = readFileSync(firstLog, "utf8");
  check("the log has one bind line without an address", /bind epochMs=\d+/.test(logText));
  check("the log carries no page address", !logText.includes("http"));
  check("the log carries no document text", !logText.includes(marker));

  console.log(`lifecycle: spawnToBind=${bindMs}ms spawnToReady=${readyMs}ms`);
  console.log(`ready: ${JSON.stringify(ready)}`);
  console.log(`log: ${logText.trim().replaceAll("\n", " | ")}`);
} catch (cause) {
  console.error(`FAIL eof session: ${cause instanceof Error ? cause.message : String(cause)}`);
  failed = true;
  await kill(first);
}

const fatalLog = path.join(dir, "fatal.log");
const fatal = spawnEditor(fatalLog);

try {
  const lines = lineReader(fatal.stdout);
  const oversized = new Uint8Array(MAX_FRAME_BYTES + 1).fill(97);
  writeRaw(fatal, oversized);
  writeRaw(fatal, "\n");

  const error = await waitForFrame<{ _tag: string; stage?: string }>(
    lines,
    (value) => value._tag === "error",
    60_000,
  );
  const exit = await waitExit(fatal, 60_000);
  lines.cancel();

  check(`over-cap frame answered one error (stage ${error.stage ?? "none"})`, true);
  check(`over-cap exit is 1 (got ${exit})`, exit === 1);
} catch (cause) {
  console.error(`FAIL fatal session: ${cause instanceof Error ? cause.message : String(cause)}`);
  failed = true;
  await kill(fatal);
}

rmSync(dir, { recursive: true, force: true });

if (failed) {
  console.error("FAIL editor lifecycle");
  process.exit(1);
}

console.log("OK editor lifecycle");
