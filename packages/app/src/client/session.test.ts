import type { SessionMessage } from "@mdv/core/protocol";
import { describe, expect, it } from "vitest";

import { defaultDisplay, type Display } from "./display.ts";
import {
  fileNameLineOf,
  headingOf,
  layoutStyleOf,
  resolveSessionTheme,
  sheetLinks,
} from "./session.ts";

const sessionOf = (overrides: Partial<SessionMessage> = {}): SessionMessage => ({
  _tag: "session",
  fileName: "notes.md",
  title: "Notes",
  showFileName: true,
  width: "900px",
  fontSize: "16px",
  markdownCss: null,
  codeCss: null,
  scrollMode: "middle",
  smoothScroll: true,
  themeMode: "system",
  ...overrides,
});

const display = (overrides: Partial<Display> = {}): Display => ({
  ...defaultDisplay(),
  ...overrides,
});

describe("session display", () => {
  it("the stored toggle is keyed to the configured mode", () => {
    expect(
      resolveSessionTheme({
        configured: "system",
        stored: "dark",
        storedMode: "system",
        system: "light",
      }),
    ).toBe("dark");

    expect(
      resolveSessionTheme({
        configured: "light",
        stored: "dark",
        storedMode: "system",
        system: "dark",
      }),
    ).toBe("light");

    expect(
      resolveSessionTheme({
        configured: "light",
        stored: "dark",
        storedMode: "light",
        system: "light",
      }),
    ).toBe("dark");
  });

  it("a configured theme mode is the initial mode and system yields the system value", () => {
    expect(
      resolveSessionTheme({
        configured: "dark",
        stored: null,
        storedMode: null,
        system: "light",
      }),
    ).toBe("dark");
    expect(
      resolveSessionTheme({
        configured: "system",
        stored: null,
        storedMode: null,
        system: "dark",
      }),
    ).toBe("dark");
  });

  it("a template with a name slot renders the basename; a front-matter title wins otherwise", () => {
    expect(headingOf(sessionOf({ title: "Notes" }), null, "notes.md")).toBe("Notes");
    expect(headingOf(sessionOf({ title: "Notes (notes.md)" }), null, "notes.md")).toBe(
      "Notes (notes.md)",
    );
    expect(headingOf(null, null, "notes.md")).toBe("notes.md");
  });

  it("hiding the header removes the file-name line only", () => {
    expect(fileNameLineOf(sessionOf({ showFileName: false }), "Notes", "notes.md")).toBeNull();
    expect(fileNameLineOf(sessionOf({ showFileName: true }), "Notes", "notes.md")).toBe("notes.md");
    expect(headingOf(sessionOf({ showFileName: false }), "Notes", "notes.md")).toBe("Notes");
  });

  it("width and font size become the two CSS custom properties", () => {
    expect(layoutStyleOf(sessionOf({ width: "1200px", fontSize: "18px" }))).toEqual({
      "--preview-width": "1200px",
      "--preview-font-size": "18px",
    });
    expect(layoutStyleOf(null)).toBeUndefined();
  });

  it("a new stylesheet address replaces the link and an unchanged one does not", () => {
    const first = sheetLinks(
      display(),
      sessionOf({ codeCss: "/stylesheet/code/aaaaaaaaaaaaaaaa" }),
    );
    const same = sheetLinks(display(), sessionOf({ codeCss: "/stylesheet/code/aaaaaaaaaaaaaaaa" }));
    const changed = sheetLinks(
      display(),
      sessionOf({ codeCss: "/stylesheet/code/bbbbbbbbbbbbbbbb" }),
    );

    expect(first).toEqual(same);
    expect(changed.at(-1)?.href).not.toBe(first.at(-1)?.href);
  });

  it("the configured code sheet links after the theme sheet in both modes", () => {
    for (const theme of ["light", "dark"] as const) {
      const links = sheetLinks(
        display({ light: { id: "light", label: "Light", type: "light" } }),
        sessionOf({ codeCss: "/stylesheet/code/aaaaaaaaaaaaaaaa" }),
      );
      const codeIndex = links.findIndex((link) => link.slot === "code");
      const themeIndex = links.findIndex((link) => link.slot === theme);
      expect(codeIndex).toBeGreaterThan(themeIndex);
      expect(links.at(-1)?.slot).toBe("code");
    }
  });

  it("a null stylesheet address renders no link", () => {
    const links = sheetLinks(display(), sessionOf({ markdownCss: null, codeCss: null }));

    expect(links.map((link) => link.slot)).toEqual(["light", "dark"]);
  });
});
