import { describe, expect, it } from "vitest";

import { parseArgs, UsageError } from "./cli.ts";

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

  it("reports a usage error without a stack trace", () => {
    const result = parseArgs(["render"]);

    expect(result).toBeInstanceOf(UsageError);
    expect(result instanceof UsageError ? result.message : "").toContain("file");
    expect(result instanceof UsageError ? result.message : "").not.toContain("\n");
  });
});
