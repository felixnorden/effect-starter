import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** A compiled Bun binary serves the client from the directory beside it. */
export const isCompiled = (importMetaUrl: string): boolean => importMetaUrl.includes("/$bunfs/");

export const resolveClientDir = (deps: {
  readonly exists: (path: string) => boolean;
  readonly execPath: string;
  readonly importMetaUrl: string;
}): string => {
  const besideBinary = join(dirname(deps.execPath), "client");
  if (deps.exists(join(besideBinary, "index.html"))) return besideBinary;
  return fileURLToPath(new URL("../dist/client", deps.importMetaUrl));
};

export const defaultClientDir = (): string =>
  resolveClientDir({
    exists: existsSync,
    execPath: process.execPath,
    importMetaUrl: import.meta.url,
  });
