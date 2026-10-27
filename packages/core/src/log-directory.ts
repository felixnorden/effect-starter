/** A cache-directory decision: where a log file goes, and whether it fell back. */
export type LogDirectory = {
  readonly dir: string;
  /** `true` when no platform cache directory exists and the temporary one is used. */
  readonly fallback: boolean;
};

export type LogDirectoryInput = {
  /** `process.platform`: `darwin`, `win32`, `linux`, or anything else. */
  readonly platform: string;
  readonly xdgCacheHome?: string | undefined;
  readonly home?: string | undefined;
  readonly localAppData?: string | undefined;
  /** The last resort; always provided by the caller. */
  readonly tmp: string;
};

const separatorFor = (platform: string): string => (platform === "win32" ? "\\" : "/");

const present = (value: string | undefined): value is string => value !== undefined && value !== "";

/** Pure path computation: no file-system module, no environment read. */
export const logDirectoryFrom = (input: LogDirectoryInput): LogDirectory => {
  const separator = separatorFor(input.platform);
  const child = (parent: string): string =>
    `${parent.replace(/[\\/]+$/, "")}${separator}markdown-viewer`;

  if (input.platform === "win32" && present(input.localAppData)) {
    return { dir: child(input.localAppData), fallback: false };
  }

  if (input.platform === "darwin" && present(input.home)) {
    return { dir: child(`${input.home}/Library/Caches`), fallback: false };
  }

  if (input.platform !== "win32" && input.platform !== "darwin") {
    // An absolute XDG path wins over the home directory on Linux; a relative
    // one is invalid per the XDG spec and is ignored.
    if (present(input.xdgCacheHome) && input.xdgCacheHome.startsWith("/")) {
      return { dir: child(input.xdgCacheHome), fallback: false };
    }
    if (present(input.home)) {
      return { dir: child(`${input.home}/.cache`), fallback: false };
    }
  }

  return { dir: child(input.tmp), fallback: true };
};
