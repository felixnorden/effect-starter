import { describe, expect, it } from "vitest";

import { mintSessionId } from "./session-identity.ts";

describe("mintSessionId", () => {
  it("mints a distinct, non-empty opaque string per call", () => {
    const first = mintSessionId();
    const second = mintSessionId();

    expect(first.length).toBeGreaterThan(0);
    expect(second.length).toBeGreaterThan(0);
    expect(first).not.toBe(second);
    expect(first).not.toContain("/");
    expect(second).not.toContain("/");
  });
});
