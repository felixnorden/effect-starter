import { describe, expect, it } from "vitest";

import { logDirectoryFrom } from "./log-directory.ts";

const base = { tmp: "/tmp" } as const;

describe("logDirectoryFrom", () => {
  it("uses XDG_CACHE_HOME on Linux when it is an absolute path", () => {
    expect(
      logDirectoryFrom({
        ...base,
        platform: "linux",
        xdgCacheHome: "/var/cache/alice",
        home: "/home/alice",
      }),
    ).toEqual({ dir: "/var/cache/alice/markdown-viewer", fallback: false });
  });

  it("falls back to the home cache directory on Linux without XDG_CACHE_HOME", () => {
    expect(logDirectoryFrom({ ...base, platform: "linux", home: "/home/alice" })).toEqual({
      dir: "/home/alice/.cache/markdown-viewer",
      fallback: false,
    });
  });

  it("uses the Library cache directory on macOS", () => {
    expect(
      logDirectoryFrom({
        ...base,
        platform: "darwin",
        xdgCacheHome: "/var/cache/alice",
        home: "/Users/alice",
      }),
    ).toEqual({ dir: "/Users/alice/Library/Caches/markdown-viewer", fallback: false });
  });

  it("uses LOCALAPPDATA on Windows", () => {
    expect(
      logDirectoryFrom({
        ...base,
        platform: "win32",
        localAppData: "C:\\Users\\alice\\AppData\\Local",
        home: "C:\\Users\\alice",
      }),
    ).toEqual({
      dir: "C:\\Users\\alice\\AppData\\Local\\markdown-viewer",
      fallback: false,
    });
  });

  it("falls back to the temporary directory when no home exists", () => {
    expect(logDirectoryFrom({ ...base, platform: "linux" })).toEqual({
      dir: "/tmp/markdown-viewer",
      fallback: true,
    });
    expect(logDirectoryFrom({ ...base, platform: "darwin" })).toEqual({
      dir: "/tmp/markdown-viewer",
      fallback: true,
    });
    expect(logDirectoryFrom({ ...base, platform: "win32", tmp: "C:\\Temp" })).toEqual({
      dir: "C:\\Temp\\markdown-viewer",
      fallback: true,
    });
  });
});
