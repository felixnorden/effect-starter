// @effect-diagnostics asyncFunction:off
/**
 * TH-3's browser evidence: a theme choice repaints every fence without a
 * reload, a navigation, a block replacement, or a scroll move. The code-controls
 * half proves N line numbers and the exact copied source.
 */
import { readFileSync } from "node:fs";
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

import { copyFixture, startPreview } from "../e2e/preview-server.ts";
import { openPanel } from "./panel.ts";

test.use({ permissions: ["clipboard-read", "clipboard-write"] });

const setMode = async (page: Page, wanted: "light" | "dark"): Promise<void> => {
  const pressed = await page
    .getByRole("button", { name: "Dark mode" })
    .getAttribute("aria-pressed");
  if ((pressed === "true") !== (wanted === "dark")) {
    await page.getByRole("button", { name: "Dark mode" }).click();
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

/** The sheet loads asynchronously, so wait for the paint, not just the value. */
const waitForRepaint = async (
  page: Page,
  before: readonly (readonly string[])[],
): Promise<string[][]> => {
  await expect
    .poll(async () => (await fenceColours(page)).flat().join("|"), { timeout: 4000 })
    .not.toBe(before.flat().join("|"));
  return fenceColours(page);
};

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

    await openPanel(page);
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
    const lightChosen = await waitForRepaint(page, lightDefault);

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
    const darkChosen = await waitForRepaint(page, darkDefault);

    for (const [index, colours] of darkChosen.entries()) {
      expect(colours, `dark fence ${index}`).not.toEqual(darkDefault[index]);
    }

    // Regression: a second choice must repaint. Hoisted links used to keep the
    // first sheet alive, so later choices were silently ignored.
    await setMode(page, "light");
    await page.selectOption('[data-theme-select="light"]', "github-light-default");
    await page.waitForFunction(
      () =>
        (document.querySelector('[data-theme-select="light"]') as HTMLSelectElement | null)
          ?.value === "github-light-default",
    );
    const lightAgain = await waitForRepaint(page, lightChosen);
    for (const [index, colours] of lightAgain.entries()) {
      expect(colours, `light fence ${index} after a second choice`).not.toEqual(lightChosen[index]);
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
    await openPanel(page);
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
    const afterCodeTheme = await waitForRepaint(page, before);
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

    // The cluster reveals on hover; the pointer must enter the block first.
    await threeLine.hover();
    await threeLine.getByRole("button", { name: "Copy code" }).click();
    const code = threeLine.getByRole("button", { name: "Copy code" });
    await expect(code).toHaveAttribute("data-mdv-state", "copied");
    await expect(code.locator('[data-mdv-icon="check"]')).toBeVisible();
    const clipboard = await page.evaluate(() => navigator.clipboard.readText());

    expect(fenceText).toBeDefined();
    expect(clipboard).toBe(fenceText);
    console.log(`line numbers: ${numbered.length}; clipboard: ${JSON.stringify(clipboard)}`);
  } finally {
    await server.stop();
    copy.stop();
  }
});

/** A control's resolved background, after any state transition settles. */
const backgroundOf = (control: Locator): Promise<string> =>
  control.evaluate((element) => getComputedStyle(element).backgroundColor);

/** The colour the panel's state utilities declare, resolved by the browser. */
const tokenBackground = (page: Page, share: number): Promise<string> =>
  page.evaluate((percent) => {
    const probe = document.createElement("div");
    probe.style.backgroundColor = `color-mix(in oklab, var(--color-base-content) ${String(percent)}%, transparent)`;
    document.body.append(probe);
    const colour = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return colour;
  }, share);

/** Which swap child the mode button shows: the moon on, the sun off, or the reverse. */
const iconOpacities = (page: Page): Promise<{ readonly on: string; readonly off: string }> =>
  page.evaluate(() => {
    const opacity = (selector: string) => {
      const icon = document.querySelector(selector);
      return icon === null ? "" : getComputedStyle(icon).opacity;
    };
    return { on: opacity(".preview-sidebar .swap-on"), off: opacity(".preview-sidebar .swap-off") };
  });

test("the panel paints hover and pressed states from the page theme", async ({ page }) => {
  const copy = copyFixture("fixtures/kitchen-sink.md");
  const server = await startPreview(copy.file);

  try {
    await page.goto(server.url);
    await page.waitForSelector("[data-block-id]");
    await openPanel(page);

    const mode = page.getByRole("button", { name: "Dark mode" });
    const numbers = page.getByRole("button", { name: "Line numbers" });
    const hoverTokens: string[] = [];
    const pressedTokens: string[] = [];

    for (const scheme of ["light", "dark"] as const) {
      await setMode(page, scheme);
      await page.mouse.move(0, 0);

      // The mode chip is a toggle: light rests empty, dark rests pressed.
      const pressedToken = await tokenBackground(page, 20);
      await expect
        .poll(() => backgroundOf(mode), { message: `${scheme} rest` })
        .toBe(scheme === "dark" ? pressedToken : "rgba(0, 0, 0, 0)");
      pressedTokens.push(pressedToken);

      // Hover the unpressed chip: one tint in both schemes, one token each.
      await expect
        .poll(() => backgroundOf(numbers), { message: `${scheme} unpressed` })
        .toBe("rgba(0, 0, 0, 0)");
      const hoverToken = await tokenBackground(page, 10);
      await numbers.hover();
      await expect
        .poll(() => backgroundOf(numbers), { message: `${scheme} hover` })
        .toBe(hoverToken);
      hoverTokens.push(hoverToken);

      // Pressed keeps its tint after the pointer leaves the chip.
      await numbers.click();
      await page.mouse.move(0, 0);
      await expect
        .poll(() => backgroundOf(numbers), { message: `${scheme} pressed` })
        .toBe(pressedToken);

      // Restore the document for the next scheme.
      await numbers.click();
      await page.mouse.move(0, 0);
      await expect
        .poll(() => backgroundOf(numbers), { message: `${scheme} released` })
        .toBe("rgba(0, 0, 0, 0)");

      // Pressed plus hovered: the stronger tint wins over the plain pressed one.
      if (scheme === "dark") {
        const compositeToken = await tokenBackground(page, 25);
        await mode.hover();
        await expect
          .poll(() => backgroundOf(mode), { message: "dark pressed hover" })
          .toBe(compositeToken);
        await page.mouse.move(0, 0);
      }
    }

    // One class, two resolutions: the token comes from the theme, not a fixed colour.
    expect(hoverTokens).toHaveLength(2);
    expect(pressedTokens).toHaveLength(2);
    expect(hoverTokens[0]).not.toBe(hoverTokens[1]);
    expect(pressedTokens[0]).not.toBe(pressedTokens[1]);

    for (const scheme of ["light", "dark"] as const) {
      await setMode(page, scheme);
      const wanted = scheme === "dark" ? { on: "1", off: "0" } : { on: "0", off: "1" };
      await expect.poll(() => iconOpacities(page), { message: `${scheme} icon` }).toEqual(wanted);
    }

    const titles = await page.evaluate(() =>
      [...document.querySelectorAll(".preview-sidebar .preview-group-title")].map((title) =>
        (title.textContent ?? "").trim(),
      ),
    );
    expect(titles).toEqual(["Appearance", "Reading"]);

    console.log(
      `panel states: hover ${hoverTokens.join(" / ")}; pressed ${pressedTokens.join(" / ")}`,
    );
  } finally {
    await server.stop();
    copy.stop();
  }
});
