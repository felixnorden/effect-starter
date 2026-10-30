import { describe, expect, it } from "vitest";

import { configKeys } from "./declaration.ts";
import { validateConfiguration } from "./validate.ts";

const nonContainer = (): number => configKeys().filter((key) => !key.container).length;

describe("server configuration validation", () => {
  it("accepts the declaration's defaults and the frame's own values", () => {
    const result = validateConfiguration([
      {
        key: "render.markdown_it",
        value: { breaks: true },
        source: "setup:render.markdown_it",
      },
    ]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(Object.keys(result.config.values)).toHaveLength(nonContainer());
    expect(result.config.values["render.markdown_it"]).toEqual({
      value: { breaks: true },
      source: "setup:render.markdown_it",
    });
    expect(result.config.values["preview.width"]).toEqual({ value: "900px", source: "default" });
  });

  it("a frame replaces the cell, so an omitted key returns to its default", () => {
    const result = validateConfiguration([
      { key: "preview.width", value: "1200px", source: "setup:preview.width" },
    ]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config.values["preview.width"]?.value).toBe("1200px");

    const reverted = validateConfiguration([]);
    expect(reverted.ok).toBe(true);
    if (!reverted.ok) return;
    expect(reverted.config.values["preview.width"]).toEqual({ value: "900px", source: "default" });
  });

  it("rejects an unknown key and a wrong type with the four fields", () => {
    const unknown = validateConfiguration([
      { key: "preview.invented", value: 1, source: "setup:preview.invented" },
    ]);
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) {
      expect(unknown.rejection.reason).toBe("unknown");
      expect(unknown.rejection).toEqual({
        reason: "unknown",
        key: "preview.invented",
        expected: "a declared key",
        received: "1",
        source: "setup:preview.invented",
      });
    }

    const wrongType = validateConfiguration([
      { key: "scroll.mode", value: "diagonal", source: "setup:scroll.mode" },
    ]);
    expect(wrongType.ok).toBe(false);
    if (!wrongType.ok) {
      expect(wrongType.rejection).toEqual({
        reason: "type",
        key: "scroll.mode",
        expected: "middle|top|relative",
        received: "diagonal",
        source: "setup:scroll.mode",
      });
    }
  });

  it("rejects a carrier the frame must not carry", () => {
    for (const key of ["export.format", "preview.options", "preview.auto_start"]) {
      const result = validateConfiguration([{ key, value: true, source: "setup:x" }]);
      expect(result.ok, key).toBe(false);
      if (!result.ok) {
        expect(result.rejection.reason, key).toBe("not-sendable");
        expect(result.rejection.key, key).toBe(key);
        expect(result.rejection.expected, key).toBe("a server-owned key");
        expect(result.rejection.received, key).toBe("true");
        expect(result.rejection.source, key).toBe("setup:x");
      }
    }
  });

  it("rejects a values member that is not an array", () => {
    const result = validateConfiguration({ preview: { width: "1px" } });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.rejection.reason).toBe("shape");
  });
});
