// @effect-diagnostics asyncFunction:off
/**
 * RD-14's browser evidence: an edit above the viewport keeps the visible text
 * and the focus where they were.
 */
import { expect, test } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";

import { copyFixture, startPreview } from "../e2e/preview-server.ts";

const FILLER = Array.from({ length: 40 }, (_, index) => `Filler paragraph ${index}.`).join("\n\n");

/** Insert one paragraph right after the front matter, above the viewport. */
const prependParagraph = (file: string): void => {
  const lines = readFileSync(file, "utf8").split("\n");
  const frontMatterEnd = lines.indexOf("---", 1);
  lines.splice(frontMatterEnd + 2, 0, "A prepended paragraph.", "");
  writeFileSync(file, lines.join("\n"));
};

test("an edit above the viewport keeps visible text and focus", async ({ page }) => {
  const copy = copyFixture("fixtures/kitchen-sink.md");
  const source = readFileSync(copy.file, "utf8");
  writeFileSync(
    copy.file,
    `${source}\n\n${FILLER}\n\n## Targets\n\nA [target link](notes.md) at the end.\n`,
  );

  const server = await startPreview(copy.file);

  try {
    await page.goto(server.url);
    await page.waitForSelector("[data-block-id]");

    const link = page.getByRole("link", { name: "target link" });
    await link.focus();
    // Move the focused link into the middle so blocks sit above the viewport.
    await page.evaluate(() => window.scrollBy(0, 200));
    await page.evaluate(
      () =>
        new Promise<void>((resolvePaint) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolvePaint())),
        ),
    );

    const before = await link.evaluate((element) => element.getBoundingClientRect().top);

    prependParagraph(copy.file);
    await page.waitForFunction(() =>
      (document.body.textContent ?? "").includes("A prepended paragraph."),
    );
    await page.evaluate(
      () =>
        new Promise<void>((resolvePaint) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolvePaint())),
        ),
    );

    const after = await link.evaluate((element) => element.getBoundingClientRect().top);
    const focused = await page.evaluate(() => document.activeElement?.textContent ?? "");
    console.log(
      `scroll: link top ${before.toFixed(1)} → ${after.toFixed(1)}; focused text: ${JSON.stringify(focused)}`,
    );

    expect(Math.abs(after - before)).toBeLessThanOrEqual(2);
    expect(focused).toBe("target link");
  } finally {
    await server.stop();
    copy.stop();
  }
});
