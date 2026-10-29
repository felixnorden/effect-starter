#!/usr/bin/env bun
/**
 * Drive a real Neovim main loop against the counting stub. An embedded UI is
 * attached over msgpack-RPC, so the engine's own cursor detection runs. The stub
 * records one sha256 digest per document frame and one close record at
 * end-of-input; this command asserts a count range and a digest per phase.
 *
 * `SKIP` names the missing binary and the reason. A stub that lost its
 * executable bit fails by name instead of taking a silent fallback.
 */
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";

import { kill, raceTimeout, root } from "./editor-process.ts";

const STUB_URL = "http://127.0.0.1:45999/";
const POLL_MS = 20;
const DEADLINE_MS = 5000;
const SETTLE_MS = 150;
const TYPING = "abcdefghijklmnopqrstuvwxyz0123";

type DocumentRecord = {
  readonly count: number;
  readonly digest: string;
};

type CloseRecord = {
  readonly closed: true;
  readonly count: number;
};

type DriverReport = {
  readonly phase: string;
  readonly opener: readonly string[];
  readonly notifies: readonly string[];
  readonly phaseCounts: Readonly<Record<string, number>>;
  readonly failures: readonly string[];
  readonly finalText?: string;
  readonly finalDigest?: string;
  readonly cursorEvents?: number;
  readonly uis?: number;
  readonly moduleAutocmds?: number;
  readonly overCapMessageOk?: boolean;
  readonly overCapMessage?: string;
  readonly captureId?: number;
  readonly augroupCount?: number;
  readonly augroupEmpty?: boolean;
  readonly augroupBeforeQuit?: boolean;
};

type Run = {
  readonly name: string;
  readonly exit: number;
  readonly output: string;
  readonly records: readonly (DocumentRecord | CloseRecord)[];
  readonly report: DriverReport;
  readonly aliveAfterOvercap: boolean;
  readonly typingDigest?: string;
  readonly typingLastDigest?: string;
  readonly typingElapsedMs: number;
  readonly manualDigest?: string;
  readonly finalBufferPath: string;
  readonly augroupEmpty: boolean;
};

const failed: string[] = [];

const check = (label: string, condition: boolean): void => {
  console.log(`${condition ? "ok" : "FAIL"} ${label}`);
  if (!condition) failed.push(label);
};

const encodeMsgpack = (value: unknown): Uint8Array => {
  const bytes: number[] = [];

  const write = (item: unknown): void => {
    if (item === null || item === undefined) {
      bytes.push(0xc0);
      return;
    }
    if (typeof item === "boolean") {
      bytes.push(item ? 0xc3 : 0xc2);
      return;
    }
    if (typeof item === "number") {
      if (item >= 0 && item < 0x80) {
        bytes.push(item);
      } else if (item <= 0xff) {
        bytes.push(0xcc, item);
      } else if (item <= 0xffff) {
        bytes.push(0xcd, (item >>> 8) & 0xff, item & 0xff);
      } else {
        bytes.push(
          0xce,
          (item >>> 24) & 0xff,
          (item >>> 16) & 0xff,
          (item >>> 8) & 0xff,
          item & 0xff,
        );
      }
      return;
    }
    if (typeof item === "string") {
      const utf8 = new TextEncoder().encode(item);
      if (utf8.length < 32) {
        bytes.push(0xa0 | utf8.length);
      } else if (utf8.length <= 0xff) {
        bytes.push(0xd9, utf8.length);
      } else {
        bytes.push(0xda, (utf8.length >>> 8) & 0xff, utf8.length & 0xff);
      }
      bytes.push(...utf8);
      return;
    }
    if (Array.isArray(item)) {
      if (item.length < 16) {
        bytes.push(0x90 | item.length);
      } else {
        bytes.push(0xdc, (item.length >>> 8) & 0xff, item.length & 0xff);
      }
      for (const entry of item) write(entry);
      return;
    }
    const entries = Object.entries(item as Record<string, unknown>);
    if (entries.length < 16) {
      bytes.push(0x80 | entries.length);
    } else {
      bytes.push(0xde, (entries.length >>> 8) & 0xff, entries.length & 0xff);
    }
    for (const [key, entry] of entries) {
      write(key);
      write(entry);
    }
  };

  write(value);
  return new Uint8Array(bytes);
};

const readRecords = (file: string): readonly (DocumentRecord | CloseRecord)[] => {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return [];
  }
  const values: (DocumentRecord | CloseRecord)[] = [];
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    try {
      values.push(JSON.parse(line) as DocumentRecord | CloseRecord);
    } catch {
      // A partial line while the stub writes; the caller retries.
    }
  }
  return values;
};

const documents = (records: readonly (DocumentRecord | CloseRecord)[]): readonly DocumentRecord[] =>
  records.filter((entry): entry is DocumentRecord => "digest" in entry);

const closed = (records: readonly (DocumentRecord | CloseRecord)[]): boolean =>
  records.some((entry) => "closed" in entry);

const waitForClose = async (
  file: string,
  ms: number,
): Promise<readonly (DocumentRecord | CloseRecord)[]> => {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const records = readRecords(file);
    if (closed(records)) return records;
    await Bun.sleep(POLL_MS);
  }
  return readRecords(file);
};

const emptyReport = (phase: string): DriverReport => ({
  phase,
  opener: [],
  notifies: [],
  phaseCounts: {},
  failures: [],
});

const runOnce = async (name: string, phase: string, wipeCommand = "bdelete"): Promise<Run> => {
  const dir = mkdtempSync(path.join(tmpdir(), `mdv-editor-refresh-${name}-`));
  const recordFile = path.join(dir, "record.jsonl");
  const reportFile = path.join(dir, "report.json");
  writeFileSync(recordFile, "");

  const driverPath = path.join(root, "packages/editor/tests/refresh-driver.lua");
  const proc = Bun.spawn({
    cmd: ["nvim", "--embed", "-u", "NONE"],
    cwd: root,
    env: {
      ...Bun.env,
      MDV_STUB_SERVER: path.join(root, "packages/editor/tests/stub-server.ts"),
      MDV_STUB_RECORD: recordFile,
      MDV_DRIVER_REPORT: reportFile,
      MDV_REFRESH_PHASE: phase,
      MDV_WIPE_COMMAND: wipeCommand,
    },
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });

  const notify = (message: unknown): void => {
    try {
      proc.stdin.write(encodeMsgpack(message));
      void proc.stdin.flush();
    } catch {
      // The process may have exited already.
    }
  };
  const lua = (code: string): void => notify([2, "nvim_exec_lua", [code, []]]);
  const command = (cmd: string): void => notify([2, "nvim_command", [cmd]]);

  const drained = (async () => {
    const reader = proc.stdout.getReader();
    try {
      for (;;) {
        const { done } = await reader.read();
        if (done) break;
      }
    } catch {
      // The channel closed with the process.
    }
  })();

  // A real UI makes Neovim run its own cursor detection.
  notify([2, "nvim_ui_attach", [80, 24, { rgb: true, ext_linegrid: true }]]);
  lua(`dofile(${JSON.stringify(driverPath)})\nreturn true`);
  await Bun.sleep(150);

  let captureSeq = 0;
  const capture = async (): Promise<DriverReport> => {
    captureSeq += 1;
    const id = captureSeq;
    lua(`_G.mdv.capture(${id})`);
    const deadline = Date.now() + 2000;
    let last = emptyReport(phase);
    while (Date.now() < deadline) {
      await Bun.sleep(10);
      try {
        last = JSON.parse(readFileSync(reportFile, "utf8")) as DriverReport;
        if (last.captureId === id) return last;
      } catch {
        // The report is not written yet.
      }
    }
    return last;
  };

  const waitFor = async (label: string, predicate: () => boolean): Promise<void> => {
    const deadline = Date.now() + DEADLINE_MS;
    while (Date.now() < deadline) {
      if (predicate()) return;
      await Bun.sleep(POLL_MS);
    }
    throw new Error(`${label} timed out after ${DEADLINE_MS} ms`);
  };

  const waitForReport = async (
    label: string,
    predicate: (report: DriverReport) => boolean,
  ): Promise<DriverReport> => {
    const deadline = Date.now() + DEADLINE_MS;
    for (;;) {
      const report = await capture();
      if (predicate(report)) return report;
      if (Date.now() >= deadline) throw new Error(`${label} timed out after ${DEADLINE_MS} ms`);
      await Bun.sleep(POLL_MS);
    }
  };

  const counts: Record<string, number> = {};

  lua("_G.mdv.open()");
  await waitFor("the open document", () => documents(readRecords(recordFile)).length >= 1);
  let report = await waitForReport("the opener", (value) => value.opener.length > 0);
  counts.open = documents(readRecords(recordFile)).length;

  let typingDigest: string | undefined;
  let typingLastDigest: string | undefined;
  let manualDigest: string | undefined;
  let typingElapsedMs = 0;
  let aliveAfterOvercap = false;
  let augroupEmpty = false;

  if (phase === "wipe") {
    const wipeCursorStart = documents(readRecords(recordFile)).length;
    lua("_G.mdv.edit(1)");
    await Bun.sleep(60);
    await Bun.sleep(SETTLE_MS);
    report = await capture();
    counts.cursor = documents(readRecords(recordFile)).length - wipeCursorStart;

    lua("_G.mdv.unmodify()");
    const wipeStart = documents(readRecords(recordFile)).length;
    command(wipeCommand);
    await Bun.sleep(SETTLE_MS);
    lua("_G.mdv.check_augroup()");
    report = await capture();
    counts.wipe = documents(readRecords(recordFile)).length - wipeStart;
    augroupEmpty = report.augroupEmpty === true;
  } else {
    const cursorStart = documents(readRecords(recordFile)).length;
    for (let step = 1; step <= 4; step += 1) {
      lua(`_G.mdv.edit(${step})`);
      await Bun.sleep(60);
    }
    await Bun.sleep(SETTLE_MS);
    report = await capture();
    counts.cursor = documents(readRecords(recordFile)).length - cursorStart;

    const unchangedStart = documents(readRecords(recordFile)).length;
    command("normal! l");
    await Bun.sleep(60);
    await Bun.sleep(SETTLE_MS);
    report = await capture();
    counts.unchanged = documents(readRecords(recordFile)).length - unchangedStart;

    const writeStart = documents(readRecords(recordFile)).length;
    lua("_G.mdv.bump('write')");
    command("write");
    await Bun.sleep(100);
    await Bun.sleep(SETTLE_MS);
    report = await capture();
    counts.write = documents(readRecords(recordFile)).length - writeStart;

    const typingStart = documents(readRecords(recordFile)).length;
    notify([2, "nvim_input", ["i"]]);
    await Bun.sleep(50);
    const typingStartedAt = Date.now();
    for (const character of TYPING) {
      notify([2, "nvim_input", [character]]);
      await Bun.sleep(10);
    }
    notify([2, "nvim_input", ["z"]]);
    await Bun.sleep(SETTLE_MS);
    report = await capture();
    counts.insertTyping = documents(readRecords(recordFile)).length - typingStart;
    typingElapsedMs = Date.now() - typingStartedAt;
    typingDigest = report.finalDigest;
    typingLastDigest = documents(readRecords(recordFile)).at(-1)?.digest;

    const leaveStart = documents(readRecords(recordFile)).length;
    lua(`_G.mdv.suffix("!")`);
    notify([2, "nvim_input", ["<Esc>"]]);
    await Bun.sleep(SETTLE_MS);
    report = await capture();
    counts.insertLeave = documents(readRecords(recordFile)).length - leaveStart;

    const manualStart = documents(readRecords(recordFile)).length;
    lua("_G.mdv.dump_buffer()");
    await Bun.sleep(40);
    command("MarkdownPreview");
    await Bun.sleep(SETTLE_MS);
    report = await capture();
    counts.manual = documents(readRecords(recordFile)).length - manualStart;
    manualDigest = documents(readRecords(recordFile)).at(-1)?.digest;

    const finalCursorStart = documents(readRecords(recordFile)).length;
    lua("_G.mdv.edit(5)");
    await Bun.sleep(SETTLE_MS);
    report = await capture();
    counts.finalCursor = documents(readRecords(recordFile)).length - finalCursorStart;

    const overcapStart = documents(readRecords(recordFile)).length;
    lua("_G.mdv.overcap()");
    await Bun.sleep(300);
    command("normal! l");
    await Bun.sleep(60);
    command("normal! l");
    await Bun.sleep(60);
    await Bun.sleep(SETTLE_MS);
    lua("_G.mdv.check_overcap()");
    report = await capture();
    counts.overCap = documents(readRecords(recordFile)).length - overcapStart;
    aliveAfterOvercap = !closed(readRecords(recordFile));

    lua("_G.mdv.check_augroup()");
    await Bun.sleep(40);
    report = await capture();
  }

  command("qall!");

  let exit: number;
  try {
    exit = await raceTimeout(proc.exited, 60_000, `${name} run`);
  } catch (cause) {
    await kill(proc);
    throw cause;
  }
  await drained;
  const output = await new Response(proc.stderr).text();
  const records = await waitForClose(recordFile, 5000);
  return {
    name,
    exit,
    output,
    records,
    report: { ...report, phaseCounts: counts },
    aliveAfterOvercap,
    typingDigest,
    typingLastDigest,
    typingElapsedMs,
    manualDigest,
    finalBufferPath: path.join(dir, "final-buffer.txt"),
    augroupEmpty,
  };
};

const stub = path.join(root, "packages/editor/tests/stub-server.ts");
const mode = Bun.spawnSync({
  cmd: ["git", "ls-files", "-s", "packages/editor/tests/stub-server.ts"],
  cwd: root,
  stdout: "pipe",
  stderr: "pipe",
});
const modeText = mode.stdout.toString().trim();
if (mode.exitCode !== 0 || !modeText.startsWith("100755")) {
  console.error(
    `FAIL editor refresh: ${stub} is not recorded as 100755 (${modeText || "untracked"})`,
  );
  process.exit(1);
}

if (Bun.which("nvim") === null) {
  console.log("SKIP editor refresh: no nvim binary on PATH");
  process.exit(0);
}

const run = await runOnce("refresh", "refresh");

console.log(`refresh: exit=${run.exit} ${run.report.phase}`);
check("the driver exited 0", run.exit === 0);
check("the driver reported no failure", run.report.failures.length === 0);
for (const failure of run.report.failures) console.log(`FAIL ${failure}`);

check(
  "the opener was called once with the stub address",
  run.report.opener.length === 1 && run.report.opener[0] === STUB_URL,
);
check(
  "exactly one notification, the oversize message",
  run.report.overCapMessageOk === true && run.report.notifies.length === 1,
);

const openCount = run.report.phaseCounts.open ?? -1;
const cursorCount = run.report.phaseCounts.cursor ?? -1;
const unchangedCount = run.report.phaseCounts.unchanged ?? -1;
const writeCount = run.report.phaseCounts.write ?? -1;
const typingCount = run.report.phaseCounts.insertTyping ?? -1;
const leaveCount = run.report.phaseCounts.insertLeave ?? -1;
const manualCount = run.report.phaseCounts.manual ?? -1;
const finalCursorCount = run.report.phaseCounts.finalCursor ?? -1;
const overCapCount = run.report.phaseCounts.overCap ?? -1;
console.log(`phase open: ${openCount}`);
console.log(`phase cursor: ${cursorCount}`);
console.log(`phase unchanged: ${unchangedCount}`);
console.log(`phase write: ${writeCount}`);
console.log(`phase insert-typing: ${typingCount}`);
console.log(`phase insert-leave: ${leaveCount}`);
console.log(`phase manual: ${manualCount}`);
console.log(`phase final cursor: ${finalCursorCount}`);
console.log(`phase over-cap: ${overCapCount}`);
console.log(
  `insert-typing rate: ${typingCount} sends in ${run.typingElapsedMs} ms (${(
    typingCount /
    (run.typingElapsedMs / 1000)
  ).toFixed(1)}/s)`,
);

check(`the open phase sent one document (got ${openCount})`, openCount === 1);
check(
  `the cursor phase sent 2 to 5 documents (got ${cursorCount})`,
  cursorCount >= 2 && cursorCount <= 5,
);
check(`the unchanged phase sent nothing (got ${unchangedCount})`, unchangedCount === 0);
check(
  `the write phase sent 1 to 2 documents (got ${writeCount})`,
  writeCount >= 1 && writeCount <= 2,
);
check(
  `the insert-typing phase sent 3 to 20 documents (got ${typingCount})`,
  typingCount >= 3 && typingCount <= 20,
);
check(`the insert-leave phase sent exactly one document (got ${leaveCount})`, leaveCount === 1);
check(`the manual phase sent exactly one document (got ${manualCount})`, manualCount === 1);
check(
  `the final-cursor phase sent 1 to 2 documents (got ${finalCursorCount})`,
  finalCursorCount >= 1 && finalCursorCount <= 2,
);
check(
  "the last insert-typing digest equals the buffer text",
  run.typingDigest !== undefined && run.typingDigest === run.typingLastDigest,
);
check(`the over-cap phase sent nothing (got ${overCapCount})`, overCapCount === 0);
check("the row stayed alive after the over-cap refusal", run.aliveAfterOvercap);

const frames = documents(run.records);
const last = frames.at(-1);
check(
  "the last document digest equals the driver's final buffer digest",
  last !== undefined &&
    run.report.finalDigest !== undefined &&
    last.digest === run.report.finalDigest,
);
const finalBufferDigest = createHash("sha256")
  .update(readFileSync(run.finalBufferPath))
  .digest("hex");
check(
  "the manual send carries the dumped buffer text",
  run.manualDigest !== undefined && run.manualDigest === finalBufferDigest,
);
check("the stub saw end-of-input", closed(run.records));
check("the augroup held triggers before the quit", run.report.augroupBeforeQuit === true);
const refreshTotal = frames.length;
const refreshPhaseSum =
  openCount +
  cursorCount +
  unchangedCount +
  writeCount +
  typingCount +
  leaveCount +
  manualCount +
  finalCursorCount +
  overCapCount;
console.log(`refresh total: ${refreshTotal}`);
check(
  `the refresh total is 10 to 32 (got ${refreshTotal})`,
  refreshTotal >= 10 && refreshTotal <= 32,
);
check(
  `the refresh total equals the phase sum, so nothing followed the capture (got ${refreshTotal}, sum ${refreshPhaseSum})`,
  refreshTotal === refreshPhaseSum,
);

for (const wipeCommand of ["bdelete", "bwipeout"] as const) {
  const wipe = await runOnce(`wipe-${wipeCommand}`, "wipe", wipeCommand);
  const wipeOpen = wipe.report.phaseCounts.open ?? -1;
  const wipeCursor = wipe.report.phaseCounts.cursor ?? -1;
  const wipeCount = wipe.report.phaseCounts.wipe ?? -1;
  const wipeTotal = documents(wipe.records).length;
  console.log(
    `wipe ${wipeCommand}: exit=${wipe.exit} open=${wipeOpen} cursor=${wipeCursor} wipe=${wipeCount} total=${wipeTotal} augroupEmpty=${wipe.augroupEmpty}`,
  );
  check(`${wipeCommand}: the driver exited 0`, wipe.exit === 0);
  check(`${wipeCommand}: the driver reported no failure`, wipe.report.failures.length === 0);
  check(
    `${wipeCommand}: the opener was called once with the stub address`,
    wipe.report.opener.length === 1 && wipe.report.opener[0] === STUB_URL,
  );
  check(`${wipeCommand}: the run was silent`, wipe.report.notifies.length === 0);
  check(`${wipeCommand}: the open phase sent one document`, wipeOpen === 1);
  check(`${wipeCommand}: the cursor phase sent one document`, wipeCursor === 1);
  check(`${wipeCommand}: the wipe phase sent nothing`, wipeCount === 0);
  check(`${wipeCommand}: the total is exactly 2`, wipeTotal === 2);
  check(`${wipeCommand}: the augroup was empty after the settle`, wipe.augroupEmpty);
  check(`${wipeCommand}: the stub saw end-of-input`, closed(wipe.records));
  if (wipe.output.trim() !== "") console.log(wipe.output.trimEnd());
}
if (run.output.trim() !== "") console.log(run.output.trimEnd());

if (failed.length > 0) {
  console.error(`FAIL editor refresh (${failed.length} checks)`);
  process.exit(1);
}

console.log("OK editor refresh");
