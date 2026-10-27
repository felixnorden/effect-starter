// @effect-diagnostics unstableApiUsage:off
import { Effect, Schema } from "effect";
import type * as HttpPlatform from "effect/http/HttpPlatform";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import type { PlatformError } from "effect/PlatformError";
import { realpath } from "node:fs/promises";
import { basename, extname, resolve, sep } from "node:path";

export class AssetRejected extends Schema.TaggedError<
  AssetRejected,
  { readonly brand: unique symbol }
>()("AssetRejected", {
  status: Schema.Literals([403, 404]),
  reason: Schema.Literals(["traversal", "symlinkEscape", "missing"]),
  message: Schema.String,
}) {}

const reject = (
  status: 403 | 404,
  reason: "traversal" | "symlinkEscape" | "missing",
  message: string,
): Effect.Effect<never, AssetRejected> =>
  Effect.fail(new AssetRejected({ status, reason, message }));

const contains = (root: string, candidate: string): boolean =>
  candidate === root || candidate.startsWith(`${root}${sep}`);

const decodePath = (encoded: string): string | null => {
  try {
    return decodeURIComponent(encoded);
  } catch {
    return null;
  }
};

/**
 * Resolve a `/local/*` request inside the source file's directory only. The
 * real-path check is what rejects a symlink escape; the segment check rejects
 * encoded traversal before the file system sees it.
 */
export const resolveAsset = (
  root: string,
  urlPath: string,
  prefix = "/local/",
): Effect.Effect<string, AssetRejected> =>
  Effect.gen(function* () {
    const withoutQuery = urlPath.split("?")[0] ?? "";
    const pathname = withoutQuery.split("#")[0] ?? "";
    if (!pathname.startsWith(prefix)) {
      return yield* reject(403, "traversal", "not a local asset path");
    }

    const encoded = pathname.slice(prefix.length);
    if (/%(?:2f|5c)/iu.test(encoded)) {
      return yield* reject(403, "traversal", "encoded separator");
    }

    const decoded = decodePath(encoded);
    if (decoded === null) {
      return yield* reject(403, "traversal", "invalid encoding");
    }

    const segments = decoded.replaceAll("\\", "/").split("/");
    if (segments.some((segment) => segment === "..")) {
      return yield* reject(403, "traversal", "parent segment");
    }

    const relative = segments.filter((segment) => segment !== "" && segment !== ".").join("/");
    if (relative === "") {
      return yield* reject(404, "missing", "no asset path");
    }

    const resolvedRoot = yield* Effect.tryPromise({
      try: () => realpath(root),
      catch: () => new AssetRejected({ status: 404, reason: "missing", message: "missing root" }),
    });

    const candidate = resolve(resolvedRoot, relative);
    if (!contains(resolvedRoot, candidate)) {
      return yield* reject(403, "traversal", "outside the root");
    }

    const real = yield* Effect.tryPromise({
      try: () => realpath(candidate),
      catch: () => new AssetRejected({ status: 404, reason: "missing", message: "missing file" }),
    });

    if (!contains(resolvedRoot, real)) {
      return yield* reject(403, "symlinkEscape", "symlink leaves the root");
    }
    return real;
  });

export type AssetPolicy = {
  readonly contentType: string;
  readonly inline: boolean;
};

/**
 * Raster images and markdown/plain text render inline; every other local file
 * is an attachment with `nosniff`, so a local HTML, SVG, or JS file downloads
 * instead of running on the loopback origin.
 */
export const assetPolicy = (path: string): AssetPolicy => {
  switch (extname(path).toLowerCase()) {
    case ".png":
      return { contentType: "image/png", inline: true };
    case ".jpg":
    case ".jpeg":
      return { contentType: "image/jpeg", inline: true };
    case ".gif":
      return { contentType: "image/gif", inline: true };
    case ".webp":
      return { contentType: "image/webp", inline: true };
    case ".md":
      return { contentType: "text/markdown; charset=utf-8", inline: true };
    case ".txt":
      return { contentType: "text/plain; charset=utf-8", inline: true };
    default:
      return { contentType: "application/octet-stream", inline: false };
  }
};

export const localAssetResponse = (
  path: string,
): Effect.Effect<
  HttpServerResponse.HttpServerResponse,
  PlatformError,
  HttpPlatform.HttpPlatform
> => {
  const policy = assetPolicy(path);
  const headers: Record<string, string> = {
    "x-content-type-options": "nosniff",
  };
  if (!policy.inline) {
    headers["content-disposition"] = `attachment; filename="${basename(path)}"`;
  }
  return HttpServerResponse.file(path, { contentType: policy.contentType }).pipe(
    Effect.map((response) => HttpServerResponse.setHeaders(response, headers)),
  );
};
