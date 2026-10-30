import { describe, expect, it } from "vitest";

import {
  handScroll,
  idleSync,
  isRestore,
  noteCursor,
  placement,
  shouldPlace,
} from "./sync-scroll.ts";

const fixture = {
  blockTop: 400,
  blockHeight: 100,
  viewportHeight: 800,
  fraction: 0.25,
  smooth: true,
  reducedMotion: false,
  seq: 5,
  appliedSeq: 5,
  restore: false,
} as const;

describe("placement", () => {
  it("middle places the block's centre at half the viewport", () => {
    expect(placement({ ...fixture, mode: "middle" })?.top).toBe(50);
  });

  it("top places the block's top at the viewport top", () => {
    expect(placement({ ...fixture, mode: "top" })?.top).toBe(400);
  });

  it("relative keeps the editor's fraction", () => {
    expect(placement({ ...fixture, mode: "relative" })?.top).toBe(200);
  });

  it("a reduced-motion or smooth-off request produces one step", () => {
    expect(placement({ ...fixture, mode: "middle", smooth: false })?.behavior).toBe("auto");
    expect(placement({ ...fixture, mode: "middle", reducedMotion: true })?.behavior).toBe("auto");
    expect(
      placement({ ...fixture, mode: "middle", smooth: false, reducedMotion: true })?.behavior,
    ).toBe("auto");
    expect(placement({ ...fixture, mode: "middle" })?.behavior).toBe("smooth");
  });

  it("a cursor older than the applied sequence is dropped", () => {
    expect(placement({ ...fixture, mode: "middle", seq: 2, appliedSeq: 5 })).toBeNull();
  });

  it("the first cursor after a document swap is a restore", () => {
    const previous = noteCursor(idleSync, 4);
    expect(isRestore(previous, 5)).toBe(true);
    expect(isRestore(noteCursor(previous, 5), 5)).toBe(false);
    expect(placement({ ...fixture, mode: "middle", restore: true })?.behavior).toBe("auto");
  });
});

describe("pause and resume", () => {
  it("a hand scroll pauses and the next cursor resumes", () => {
    const paused = handScroll(idleSync);
    expect(shouldPlace(paused)).toBe(false);

    const resumed = noteCursor(paused, 6);
    expect(shouldPlace(resumed)).toBe(true);
    expect(resumed.lastCursorSeq).toBe(6);
  });
});
