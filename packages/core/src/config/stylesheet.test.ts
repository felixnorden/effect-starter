import { describe, expect, it } from "vitest";

import { stylesheetAddress } from "./stylesheet.ts";

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);

describe("stylesheet address", () => {
  it("names the slot and the content hash, never a path or file name", () => {
    expect(stylesheetAddress("markdown", bytes("body { color: red }"))).toMatch(
      /^\/stylesheet\/markdown\/[0-9a-f]{16}$/u,
    );
  });

  it("changes when the content changes and stays for the same content", () => {
    const first = stylesheetAddress("code", bytes("a { color: red }"));
    expect(stylesheetAddress("code", bytes("a { color: red }"))).toBe(first);
    expect(stylesheetAddress("code", bytes("a { color: blue }"))).not.toBe(first);
  });

  it("keeps the two slots apart", () => {
    expect(stylesheetAddress("markdown", bytes("x"))).not.toBe(
      stylesheetAddress("code", bytes("x")),
    );
  });
});
