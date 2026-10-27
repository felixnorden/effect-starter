import { describe, expect, it } from "vitest";

import { createLogSink, logFilePath } from "./log-sink.ts";

const recorder = () => {
  const calls: { readonly path: string; readonly text: string }[] = [];
  return {
    calls,
    append: (path: string, text: string) => {
      calls.push({ path, text });
    },
    get text(): string {
      return calls.map((call) => call.text).join("");
    },
  };
};

describe("createLogSink", () => {
  it("appends to the process's own file, in order", () => {
    const sink = recorder();
    const log = createLogSink({
      path: null,
      directory: "/cache/markdown-viewer",
      pid: 4242,
      capBytes: 1024,
      append: sink.append,
    });

    log.write("first");
    log.write("second");

    expect(sink.calls).toHaveLength(2);
    expect(
      sink.calls.every(
        (call) => call.path === logFilePath({ directory: "/cache/markdown-viewer", pid: 4242 }),
      ),
    ).toBe(true);
    expect(sink.calls[0]?.path.endsWith("4242.log")).toBe(true);
    expect(sink.calls.map((call) => call.text).join("")).toBe("first\nsecond\n");
  });

  it("stops at the cap and ends with one truncation note", () => {
    const sink = recorder();
    const log = createLogSink({
      path: "/tmp/explicit.log",
      directory: "/cache",
      pid: 1,
      capBytes: 64,
      append: sink.append,
    });

    for (let index = 0; index < 20; index += 1) {
      log.write(`line-${index}-${"x".repeat(10)}`);
    }

    expect(sink.text.length).toBeLessThanOrEqual(64);
    expect(sink.calls.at(-1)?.text).toBe("log truncated\n");
    expect(sink.calls.every((call) => call.path === "/tmp/explicit.log")).toBe(true);
  });

  it("swallows an append failure", () => {
    const log = createLogSink({
      path: "/tmp/x.log",
      directory: "/cache",
      pid: 1,
      capBytes: 64,
      append: () => {
        throw new Error("disk full");
      },
    });

    expect(() => log.write("hello")).not.toThrow();
  });
});
