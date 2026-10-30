import { describe, expect, it } from "vitest";

import { parseArgs, UsageError } from "./cli.ts";
import { formatVersion, VERSION_FAILURE } from "./version-report.ts";

describe("parseArgs", () => {
  it("returns the render command", () => {
    expect(parseArgs(["render", "a.md"])).toEqual({ _tag: "render", file: "a.md" });
  });

  it("returns the preview command", () => {
    expect(parseArgs(["preview", "a.md"])).toEqual({ _tag: "preview", file: "a.md" });
  });

  it("returns the dev command", () => {
    expect(parseArgs(["dev", "a.md"])).toEqual({ _tag: "dev", file: "a.md" });
  });

  it("returns the version command", () => {
    expect(parseArgs(["version"])).toEqual({ _tag: "version" });
  });

  it("prints package, Bun, and editor wire versions and exits zero", () => {
    expect(
      formatVersion({
        packageVersion: "1.2.3",
        bunVersion: "1.4.2",
        editorProtocolVersion: 1,
      }),
    ).toBe("package 1.2.3\nbun 1.4.2\nwire 1");
  });

  it("exits one with one message when a value cannot be resolved", () => {
    expect(
      formatVersion({ packageVersion: null, bunVersion: "1.4.2", editorProtocolVersion: 1 }),
    ).toBeNull();
    expect(VERSION_FAILURE.split("\n")).toHaveLength(1);
  });

  it("returns the editor command with no file", () => {
    expect(parseArgs(["editor"])).toEqual({
      _tag: "editor",
      logFile: null,
      host: "127.0.0.1",
      port: 0,
      expose: false,
    });
  });

  it("carries an explicit editor log file", () => {
    expect(parseArgs(["editor", "--log-file", "/tmp/x.log"])).toEqual({
      _tag: "editor",
      logFile: "/tmp/x.log",
      host: "127.0.0.1",
      port: 0,
      expose: false,
    });
  });

  it("reports a missing --log-file value without a newline", () => {
    const result = parseArgs(["editor", "--log-file"]);

    expect(result).toBeInstanceOf(UsageError);
    expect(result instanceof UsageError ? result.message : "").toContain("--log-file");
    expect(result instanceof UsageError ? result.message : "").not.toContain("\n");
  });

  it("parses --host, --port, --expose and --log-file", () => {
    expect(
      parseArgs(["editor", "--host", "127.0.0.1", "--port", "3000", "--log-file", "/tmp/x.log"]),
    ).toEqual({
      _tag: "editor",
      logFile: "/tmp/x.log",
      host: "127.0.0.1",
      port: 3000,
      expose: false,
    });
  });

  it("refuses a non-loopback host with one message naming PT-5", () => {
    const result = parseArgs(["editor", "--host", "0.0.0.0"]);
    expect(result).toBeInstanceOf(UsageError);
    const message = result instanceof UsageError ? result.message : "";
    expect(message).toContain("PT-5");
    expect(message).toContain("0.0.0.0");
  });

  it("refuses an exposure request with the same wording", () => {
    const result = parseArgs(["editor", "--expose"]);
    expect(result).toBeInstanceOf(UsageError);
    const message = result instanceof UsageError ? result.message : "";
    expect(message).toContain("PT-5");
    expect(message).toContain("--expose");
  });

  it("reports a usage error without a stack trace", () => {
    const result = parseArgs(["render"]);

    expect(result).toBeInstanceOf(UsageError);
    expect(result instanceof UsageError ? result.message : "").toContain("file");
    expect(result instanceof UsageError ? result.message : "").not.toContain("\n");
  });
});
