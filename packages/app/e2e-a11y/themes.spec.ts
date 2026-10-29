// @effect-diagnostics asyncFunction:off
/**
 * TH-3's browser evidence: a theme choice repaints every fence without a
 * reload, a navigation, a block replacement, or a scroll move. The code-controls
 * half proves N line numbers and the exact copied source.
 */
import { readFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

import { copyFixture, startPreview } from "../e2e/preview-server.ts";

test.use({ permissions: ["clipboard-read", "clipboard-write"] });

const setMode = async (page: Page, wanted: "light" | "dark"): Promise<void> => {
  const current = await page.evaluate(() =>
    document.documentElement.getAttribute("data-color-mode"),
  );
  if (current !== wanted) {
    await page.getByRole("button", { name: /^(Light|Dark)$/u }).click();
  }
  await page.waitForFunction(
    (mode) => document.documentElement.getAttribute("data-color-mode") === mode,
    wanted,
  );
};

const fenceColours = (page: Page): Promise<string[][]> =>
  page.evaluate(() =>
    [...document.querySelectorAll(".shiki")].map((fence) =>
      [...fence.querySelectorAll("span")]
        .map((token) => getComputedStyle(token).color)
        .filter((colour) => colour !== ""),
    ),
  );

test("repaints both modes without a reload and without replacing a block", async ({ page }) => {
  const copy = copyFixture("fixtures/render-fidelity/themes-alt.md");
  const server = await startPreview(copy.file);
  let navigations = 0;
  page.on("framenavigated", () => {
    navigations += 1;
  });

  try {
    await page.goto(server.url);
    await page.waitForSelector(".shiki");
    navigations = 0;

    await setMode(page, "light");
    const before = await page.evaluate(() => {
      const block = document.querySelector("[data-block-id]");
      (window as unknown as { __mdvBlock?: Element | null }).__mdvBlock = block;
      return {
        text: block?.textContent ?? "",
        scrollY: window.scrollY,
        blocks: document.querySelectorAll("[data-block-id]").length,
      };
    });
    const lightDefault = await fenceColours(page);

    await page.selectOption('[data-theme-select="light"]', "light-plus");
    await page.waitForFunction(
      () =>
        (document.querySelector('[data-theme-select="light"]') as HTMLSelectElement | null)
          ?.value === "light-plus",
    );
    const lightChosen = await fenceColours(page);

    expect(lightChosen).toHaveLength(lightDefault.length);
    for (const [index, colours] of lightChosen.entries()) {
      expect(colours, `light fence ${index}`).not.toEqual(lightDefault[index]);
    }

    await setMode(page, "dark");
    const darkDefault = await fenceColours(page);
    await page.selectOption('[data-theme-select="dark"]', "dark-plus");
    await page.waitForFunction(
      () =>
        (document.querySelector('[data-theme-select="dark"]') as HTMLSelectElement | null)
          ?.value === "dark-plus",
    );
    const darkChosen = await fenceColours(page);

    for (const [index, colours] of darkChosen.entries()) {
      expect(colours, `dark fence ${index}`).not.toEqual(darkDefault[index]);
    }

    const after = await page.evaluate(() => {
      const block = document.querySelector("[data-block-id]");
      return {
        same: (window as unknown as { __mdvBlock?: Element | null }).__mdvBlock === block,
        text: block?.textContent ?? "",
        scrollY: window.scrollY,
        blocks: document.querySelectorAll("[data-block-id]").length,
      };
    });

    expect(navigations).toBe(0);
    expect(after.same).toBe(true);
    expect(after.text).toBe(before.text);
    expect(after.scrollY).toBe(before.scrollY);
    expect(after.blocks).toBe(before.blocks);
  } finally {
    await server.stop();
    copy.stop();
  }
});

test("a non-default page theme keeps every code role resolving", async ({ page }) => {
  const copy = copyFixture("fixtures/render-fidelity/themes.md");
  const server = await startPreview(copy.file);

  try {
    await page.goto(server.url);
    await page.waitForSelector(".shiki");
    await setMode(page, "light");

    const before = await fenceColours(page);
    expect(before.flat().every((colour) => colour.trim() !== "")).toBe(true);

    await page.evaluate(() => document.documentElement.setAttribute("data-theme", "garden"));
    const afterPageTheme = await fenceColours(page);
    expect(afterPageTheme).toEqual(before);

    await page.selectOption('[data-theme-select="light"]', "light-plus");
    await page.waitForFunction(
      () =>
        (document.querySelector('[data-theme-select="light"]') as HTMLSelectElement | null)
          ?.value === "light-plus",
    );
    const afterCodeTheme = await fenceColours(page);
    expect(afterCodeTheme).not.toEqual(before);
    console.log(
      `garden kept ${before.length} fences unchanged; the code theme still repaints them`,
    );
  } finally {
    await server.stop();
    copy.stop();
  }
});

test("numbers N lines and copies the exact source", async ({ page }) => {
  const copy = copyFixture("fixtures/render-fidelity/code-controls.md");
  const server = await startPreview(copy.file);
  const source = readFileSync(copy.file, "utf8");
  const fenceText = [...source.matchAll(/```ts\n([\s\S]*?)```/gu)]
    .map((match) => match[1] ?? "")
    .find((text) => text.split("\n").filter(Boolean).length === 3);

  try {
    await page.goto(server.url);
    await page.waitForSelector(".shiki");
    await page.getByRole("button", { name: "Line numbers" }).click();

    const threeLine = page.locator("[data-block-id]").filter({ hasText: "const y = 2;" });
    // Chrome reports the counter expression, not the rendered number, so the
    // proof counts the lines that increment the counter and checks the guard.
    const lines = await threeLine.evaluate((block) =>
      [...block.querySelectorAll(".line")].map((line) => ({
        increment: getComputedStyle(line, "::before").counterIncrement,
        content: getComputedStyle(line, "::before").content,
        text: line.textContent ?? "",
      })),
    );
    const numbered = lines.filter((line) => line.increment.includes("mdv-line"));
    expect(numbered).toHaveLength(3);
    expect(numbered.map((line) => line.text)).toEqual([
      "const x = 1;",
      "const y = 2;",
      "const z = 3;",
    ]);
    expect(lines.at(-1)?.text).toBe("");
    expect(lines.at(-1)?.content).toBe("none");

    await threeLine.getByRole("button", { name: "Copy code" }).click();
    await expect(threeLine.getByRole("button", { name: "Copy code" })).toHaveText("Copied");
    const clipboard = await page.evaluate(() => navigator.clipboard.readText());

    expect(fenceText).toBeDefined();
    expect(clipboard).toBe(fenceText);
    console.log(`line numbers: ${numbered.length}; clipboard: ${JSON.stringify(clipboard)}`);
  } finally {
    await server.stop();
    copy.stop();
  }
});
