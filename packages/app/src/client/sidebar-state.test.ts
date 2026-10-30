import { describe, expect, it } from "vitest";

import { readSidebarState, SIDEBAR_KEY, toggleSidebarState } from "./sidebar-state.ts";

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

describe("readSidebarState", () => {
  it("opens the panel on a first visit", () => {
    expect(readSidebarState({ storage: fakeStorage().storage })).toBe("open");
  });

  it("reads either stored state back", () => {
    for (const state of ["open", "rail"] as const) {
      expect(readSidebarState({ storage: fakeStorage({ [SIDEBAR_KEY]: state }).storage })).toBe(
        state,
      );
    }
  });

  it("falls back to the open panel for an unknown value", () => {
    expect(readSidebarState({ storage: fakeStorage({ [SIDEBAR_KEY]: "half" }).storage })).toBe(
      "open",
    );
  });

  it("takes the caller's default when nothing is stored", () => {
    expect(readSidebarState({ storage: fakeStorage().storage, defaultState: "rail" })).toBe("rail");
    expect(
      readSidebarState({
        storage: fakeStorage({ [SIDEBAR_KEY]: "open" }).storage,
        defaultState: "rail",
      }),
    ).toBe("open");
  });
});

describe("toggleSidebarState", () => {
  it("flips both ways and stores the result under one key", () => {
    const { storage, writes } = fakeStorage();

    const rail = toggleSidebarState("open", { storage });
    expect(rail).toBe("rail");
    expect(readSidebarState({ storage })).toBe("rail");

    const open = toggleSidebarState(rail, { storage });
    expect(open).toBe("open");
    expect(readSidebarState({ storage })).toBe("open");

    expect(writes).toEqual([
      [SIDEBAR_KEY, "rail"],
      [SIDEBAR_KEY, "open"],
    ]);
  });
});
