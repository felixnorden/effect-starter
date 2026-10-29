import { describe, expect, it } from "vitest";

import { applyView, COLOR_MODE_ATTRIBUTE, type View } from "./axes.ts";

const recordingRoot = () => {
  const calls: Array<readonly [string, string]> = [];

  return {
    calls,
    root: {
      setAttribute: (name: string, value: string) => {
        calls.push([name, value]);
      },
    },
  };
};

const VIEW: View = { pageTheme: "garden", colorMode: "light", width: "wide", scale: "large" };

describe("applyView", () => {
  it("writes the theme name, colour mode, width, and scale as one set", () => {
    const { calls, root } = recordingRoot();

    applyView(VIEW, root);

    expect(calls).toEqual([
      ["data-theme", "garden"],
      [COLOR_MODE_ATTRIBUTE, "light"],
      ["data-width", "wide"],
      ["data-scale", "large"],
    ]);
  });

  it("names the attribute the generated code-theme sheets key on", () => {
    expect(COLOR_MODE_ATTRIBUTE).toBe("data-color-mode");
  });
});
