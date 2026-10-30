// @effect-diagnostics asyncFunction:off
/**
 * SS-1, SS-3, SS-4 and ED-10 in the real page: placement follows the measured
 * geometry, one step when motion is reduced or smooth is off, a hand scroll
 * holds, and a reload restores the cursor.
 */
import { expect, test, type Page } from "@playwright/test";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { startEditorPage, type EditorPage } from "../e2e/preview-server.ts";

const paragraphs = 60;
const lines = Array.from({ length: 20 }, (_, index) => 4 * index + 1);
const documentText = Array.from({ length: paragraphs }, (_, index) => `Paragraph ${index}.`).join(
  "\n\n",
);

const cursor = (line: number, fraction = 0.5) => ({
  _tag: "cursor" as const,
  editorProtocolVersion: 1,
  line,
  fraction,
});

const start = (mode: "middle" | "top" | "relative", smooth = false): Promise<EditorPage> =>
  startEditorPage({
    configuration: [
      { key: "scroll.mode", value: mode, source: "setup:scroll.mode" },
      { key: "scroll.smooth", value: smooth, source: "setup:scroll.smooth" },
      { key: "preview.show_filename", value: false, source: "setup:preview.show_filename" },
    ],
    document: { path: join(tmpdir(), "scroll.md"), text: documentText },
  });

const waitForCursors = async (page: Page): Promise<void> => {
  await page.waitForSelector("[data-block-id]");
  await expect(page.locator("[data-block-id]")).toHaveCount(paragraphs);
};

const measuredTop = async (page: Page, line: number): Promise<number> =>
  page.evaluate((lineNumber) => {
    const id = `b${Math.floor(lineNumber / 2) + 1}`;
    const element = document.querySelector<HTMLElement>(`[data-block-id="${id}"]`);
    if (element === null) throw new Error(`missing block ${id}`);
    return element.getBoundingClientRect().top + window.scrollY;
  }, line);

const expectedTop = async (
  page: Page,
  line: number,
  mode: "middle" | "top" | "relative",
  fraction: number,
): Promise<number> => {
  const { blockTop, blockHeight, viewport } = await page.evaluate((lineNumber) => {
    const id = `b${Math.floor(lineNumber / 2) + 1}`;
    const element = document.querySelector<HTMLElement>(`[data-block-id="${id}"]`);
    if (element === null) throw new Error(`missing block ${id}`);
    const rect = element.getBoundingClientRect();
    return { blockTop: rect.top + window.scrollY, blockHeight: rect.height, viewport: innerHeight };
  }, line);

  const top =
    mode === "top"
      ? blockTop
      : mode === "relative"
        ? blockTop - fraction * viewport
        : blockTop - (viewport - blockHeight) / 2;
  return Math.max(0, top);
};

for (const mode of ["middle", "top", "relative"] as const) {
  test(`SS-1: ${mode} places each cursor at the measured offset`, async ({ page }) => {
    const server = await start(mode, false);

    try {
      await page.goto(server.url);
      await waitForCursors(page);
      for (const line of lines) {
        const fraction = mode === "relative" ? 0.25 : 0.5;
        server.write(cursor(line, fraction));
        await expect
          .poll(() => measuredTop(page, line), { timeout: 10_000 })
          .toBeGreaterThanOrEqual(0);
        const target = await expectedTop(page, line, mode, fraction);
        await expect
          .poll(() => page.evaluate(() => Math.round(window.scrollY)))
          .toBe(Math.round(target));
      }
    } finally {
      await server.stop();
    }
  });
}

test("SS-3: reduced motion and smooth-off take one step", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const server = await start("middle", true);

  try {
    await page.goto(server.url);
    await waitForCursors(page);
    await page.evaluate(() => {
      const calls: unknown[] = [];
      (window as unknown as { __scrollCalls: unknown[] }).__scrollCalls = calls;
      const original = window.scrollTo.bind(window);
      window.scrollTo = ((options: ScrollToOptions) => {
        calls.push(options.behavior ?? "auto");
        original(options);
      }) as typeof window.scrollTo;
    });

    server.write(cursor(39));
    const target = await expectedTop(page, 39, "middle", 0.5);
    await expect
      .poll(() => page.evaluate(() => Math.round(window.scrollY)))
      .toBe(Math.round(target));
    const calls = await page.evaluate(
      () => (window as unknown as { __scrollCalls: unknown[] }).__scrollCalls,
    );
    expect(calls).toEqual(["auto"]);
  } finally {
    await server.stop();
  }
});

test("SS-3: scroll.smooth = false takes one step", async ({ page }) => {
  const server = await start("middle", false);

  try {
    await page.goto(server.url);
    await waitForCursors(page);
    await page.evaluate(() => {
      const calls: unknown[] = [];
      (window as unknown as { __scrollCalls: unknown[] }).__scrollCalls = calls;
      const original = window.scrollTo.bind(window);
      window.scrollTo = ((options: ScrollToOptions) => {
        calls.push(options.behavior ?? "auto");
        original(options);
      }) as typeof window.scrollTo;
    });

    server.write(cursor(39));
    const target = await expectedTop(page, 39, "middle", 0.5);
    await expect
      .poll(() => page.evaluate(() => Math.round(window.scrollY)))
      .toBe(Math.round(target));
    const calls = await page.evaluate(
      () => (window as unknown as { __scrollCalls: unknown[] }).__scrollCalls,
    );
    expect(calls).toEqual(["auto"]);
  } finally {
    await server.stop();
  }
});

test("SS-4: a hand scroll holds until the next cursor", async ({ page }) => {
  const server = await start("top");

  try {
    await page.goto(server.url);
    await waitForCursors(page);
    server.write(cursor(5));
    await expect.poll(() => page.evaluate(() => Math.round(window.scrollY))).toBeGreaterThan(0);

    const target = await page.evaluate(() => window.scrollY + 400);
    await page.evaluate((top) => window.scrollTo(0, top), target);
    await page.waitForTimeout(50);
    const held = await page.evaluate(() => Math.round(window.scrollY));
    expect(Math.abs(held - target)).toBeLessThanOrEqual(2);

    // No cursor yet: a document update must not move the page.
    server.write({
      _tag: "document",
      editorProtocolVersion: 1,
      path: join(tmpdir(), "scroll.md"),
      text: `${documentText}\n\nA changed tail.`,
    });
    await page.waitForTimeout(100);
    expect(await page.evaluate(() => Math.round(window.scrollY))).toBe(held);

    server.write(cursor(21));
    await expect.poll(() => page.evaluate(() => Math.round(window.scrollY))).not.toBe(held);
  } finally {
    await server.stop();
  }
});

test("ED-10: a reload restores content and the last cursor", async ({ page }) => {
  const server = await start("top");

  try {
    await page.goto(server.url);
    await waitForCursors(page);
    server.write(cursor(31));
    const before = await expectedTop(page, 31, "top", 0.5);
    await expect
      .poll(() => page.evaluate(() => Math.round(window.scrollY)))
      .toBe(Math.round(before));

    await page.reload();
    await page.waitForSelector("[data-block-id]");
    await expect
      .poll(() => page.evaluate(() => Math.round(window.scrollY)))
      .toBe(Math.round(before));
    await expect(page.locator(".preview-body")).toContainText("Paragraph 15.");
  } finally {
    await server.stop();
  }
});
