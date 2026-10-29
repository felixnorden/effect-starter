import { describe, expect, it } from "vitest";

import { readPresets, SCALE_KEY, setPreset, WIDTH_KEY, type Presets } from "./view-presets.ts";

const fakeStorage = (values: Record<string, string> = {}) => {
  const data = new Map(Object.entries(values));
  const writes: Array<readonly [string, string]> = [];

  const storage = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
      writes.push([key, value]);
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
    clear: () => data.clear(),
    key: (index: number) => [...data.keys()][index] ?? null,
    get length() {
      return data.size;
    },
  } as Storage;

  return { storage, writes };
};

const NORMAL: Presets = { width: "normal", scale: "normal" };

describe("readPresets", () => {
  it("reads a stored width and scale", () => {
    const { storage } = fakeStorage({ [WIDTH_KEY]: "wide", [SCALE_KEY]: "small" });

    expect(readPresets({ storage })).toEqual({ width: "wide", scale: "small" });
  });

  it("falls back per axis and rejects other values", () => {
    const { storage } = fakeStorage({ [WIDTH_KEY]: "huge", [SCALE_KEY]: "large" });

    expect(readPresets({ storage })).toEqual({ width: "normal", scale: "large" });
  });

  it("defaults both axes when nothing is stored", () => {
    const { storage } = fakeStorage();

    expect(readPresets({ storage })).toEqual(NORMAL);
  });
});

describe("setPreset", () => {
  it("writes the chosen value for one axis", () => {
    const { storage, writes } = fakeStorage();

    const next = setPreset(NORMAL, "scale", "large", { storage });

    expect(next).toEqual({ width: "normal", scale: "large" });
    expect(writes).toEqual([[SCALE_KEY, "large"]]);
  });

  it("writes nothing for an unknown value", () => {
    const { storage, writes } = fakeStorage();

    expect(setPreset(NORMAL, "width", "huge", { storage })).toBe(NORMAL);
    expect(writes).toEqual([]);
  });
});
