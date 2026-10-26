import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import { BlockKindSchema } from "../model.ts";

const decode = Schema.decodeUnknownSync(BlockKindSchema);

describe("BlockKindSchema", () => {
  it("accepts the three additive kinds", () => {
    expect(decode("math")).toBe("math");
    expect(decode("toc")).toBe("toc");
    expect(decode("footnote")).toBe("footnote");
  });

  it("rejects an unknown kind", () => {
    expect(() => decode("diagram")).toThrow();
  });
});
