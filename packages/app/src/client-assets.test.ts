import { describe, expect, it } from "vitest";
import path from "node:path";

import { isCompiled, resolveClientDir } from "./client-assets.ts";

describe("client assets", () => {
  it("prefers the client directory beside a compiled binary", () => {
    const root = "/opt/mdv/bin";
    const dir = resolveClientDir({
      exists: (candidate) => candidate === path.join(root, "client", "index.html"),
      execPath: path.join(root, "mdv-darwin-arm64"),
      importMetaUrl: "file:///$bunfs/root/mdv-darwin-arm64",
    });

    expect(dir).toBe(path.join(root, "client"));
  });

  it("falls back to the checkout build when no client sits beside the executable", () => {
    const dir = resolveClientDir({
      exists: () => false,
      execPath: "/Users/me/.bun/bin/bun",
      importMetaUrl: "file:///repo/packages/app/src/main.ts",
    });

    expect(dir).toBe("/repo/packages/app/dist/client");
  });

  it("detects the compiled virtual filesystem", () => {
    expect(isCompiled("file:///$bunfs/root/mdv-darwin-arm64")).toBe(true);
    expect(isCompiled("file:///repo/packages/app/src/main.ts")).toBe(false);
  });
});
