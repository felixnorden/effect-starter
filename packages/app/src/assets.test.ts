// @effect-diagnostics asyncFunction:off
import { Effect } from "effect";
import { mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { assetPolicy, resolveAsset } from "./assets.ts";

const roots: string[] = [];

const makeRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), "preview-assets-"));
  roots.push(root);
  return root;
};

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const outcome = (root: string, urlPath: string, prefix = "/local/") =>
  Effect.runPromise(
    Effect.match(resolveAsset(root, urlPath, prefix), {
      onFailure: (error) => ({ ok: false as const, error }),
      onSuccess: (path) => ({ ok: true as const, path }),
    }),
  );

describe("resolveAsset", () => {
  it("resolves a file inside the root", async () => {
    const root = makeRoot();
    mkdirSync(join(root, "img"));
    writeFileSync(join(root, "img", "a.png"), "png");

    const result = await outcome(root, "/local/img/a.png");

    expect(result.ok).toBe(true);
    expect(result.ok ? result.path : "").toContain("img/a.png");
  });

  it("rejects a .. traversal", async () => {
    const root = makeRoot();

    const result = await outcome(root, "/local/../../secret");

    expect(result).toMatchObject({
      ok: false,
      error: { status: 403, reason: "traversal" },
    });
  });

  it("rejects a percent-encoded traversal", async () => {
    const root = makeRoot();

    const result = await outcome(root, "/local/%2e%2e/secret");

    expect(result).toMatchObject({
      ok: false,
      error: { status: 403, reason: "traversal" },
    });
  });

  it("rejects a symlink that escapes the root", async () => {
    const root = makeRoot();
    const outside = makeRoot();
    writeFileSync(join(outside, "secret.txt"), "secret");
    symlinkSync(join(outside, "secret.txt"), join(root, "link.txt"));

    const result = await outcome(root, "/local/link.txt");

    expect(result).toMatchObject({
      ok: false,
      error: { status: 403, reason: "symlinkEscape" },
    });
  });

  it("answers 404 for a missing file", async () => {
    const root = makeRoot();

    const result = await outcome(root, "/local/missing.png");

    expect(result).toMatchObject({
      ok: false,
      error: { status: 404, reason: "missing" },
    });
  });

  it("ignores a query string", async () => {
    const root = makeRoot();
    writeFileSync(join(root, "a.png"), "png");

    const bare = await outcome(root, "/local/a.png");
    const queried = await outcome(root, "/local/a.png?v=2");

    expect(queried).toEqual(bare);
  });

  it("is rooted at the source file's directory, not its parent", async () => {
    const parent = makeRoot();
    const root = join(parent, "docs");
    mkdirSync(root);
    writeFileSync(join(parent, "secret.txt"), "secret");

    const result = await outcome(root, "/local/../secret.txt");

    expect(result).toMatchObject({
      ok: false,
      error: { status: 403, reason: "traversal" },
    });
  });
});

describe("assetPolicy", () => {
  it("serves raster images inline", () => {
    expect(assetPolicy("a.png")).toEqual({ contentType: "image/png", inline: true });
    expect(assetPolicy("a.jpeg")).toEqual({ contentType: "image/jpeg", inline: true });
    expect(assetPolicy("a.gif")).toEqual({ contentType: "image/gif", inline: true });
    expect(assetPolicy("a.webp")).toEqual({ contentType: "image/webp", inline: true });
  });

  it("serves markdown and plain text inline", () => {
    expect(assetPolicy("a.md").contentType).toContain("text/markdown");
    expect(assetPolicy("a.txt").contentType).toContain("text/plain");
    expect(assetPolicy("a.md").inline).toBe(true);
  });

  it("serves every other file as an attachment that must not sniff", () => {
    for (const file of ["a.html", "a.svg", "a.js"]) {
      const policy = assetPolicy(file);
      expect(policy.inline).toBe(false);
      expect(policy.contentType).toBe("application/octet-stream");
    }
  });
});

describe("resolveAsset with a route prefix", () => {
  it("resolves a reference inside the image root", async () => {
    const root = makeRoot();
    writeFileSync(join(root, "a.png"), "png");

    const result = await outcome(root, "/image-root/a.png", "/image-root/");

    expect(result.ok).toBe(true);
    expect(result.ok ? result.path : "").toContain("a.png");
    expect(result.ok ? result.path.startsWith(realpathSync(root)) : false).toBe(true);
  });

  it("refuses a parent segment inside a root reference", async () => {
    const root = makeRoot();

    const result = await outcome(root, "/image-root/../../secret", "/image-root/");

    expect(result).toMatchObject({
      ok: false,
      error: { status: 403, reason: "traversal" },
    });
  });

  it("refuses an encoded separator inside a root reference", async () => {
    const root = makeRoot();

    const result = await outcome(root, "/image-root/a%2Fb.png", "/image-root/");

    expect(result).toMatchObject({
      ok: false,
      error: { status: 403, reason: "traversal" },
    });
  });

  it("refuses a symlink that leaves the image root", async () => {
    const root = makeRoot();
    const outside = makeRoot();
    writeFileSync(join(outside, "secret.txt"), "secret");
    symlinkSync(join(outside, "secret.txt"), join(root, "link.txt"));

    const result = await outcome(root, "/image-root/link.txt", "/image-root/");

    expect(result).toMatchObject({
      ok: false,
      error: { status: 403, reason: "symlinkEscape" },
    });
  });
});
