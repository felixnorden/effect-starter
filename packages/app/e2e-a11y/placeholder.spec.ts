// @effect-diagnostics asyncFunction:off
/**
 * AS-5's browser half: a missing local image keeps the declared box and the
 * authored alt as its accessible name.
 */
import { expect, test } from "@playwright/test";

import { copyFixture, startPreview } from "../e2e/preview-server.ts";

test("keeps the declared box and the accessible name for a missing image", async ({ page }) => {
  const copy = copyFixture("fixtures/render-fidelity/images-missing.md");
  const server = await startPreview(copy.file);

  try {
    await page.goto(server.url);
    await page.waitForSelector("[data-mdv-placeholder]");

    const placeholder = page.getByRole("img", { name: "diagram" });
    await expect(placeholder).toHaveCount(1);

    const resolved = await placeholder.textContent();
    expect(resolved).toMatch(/^\/local\/missing\/pixel\.png$/u);

    const box = await placeholder.boundingBox();
    expect(box).not.toBeNull();
    expect(Math.abs((box?.width ?? 0) - 120)).toBeLessThanOrEqual(1);
    expect(Math.abs((box?.height ?? 0) - 80)).toBeLessThanOrEqual(1);
    console.log(`placeholder box: ${box?.width}x${box?.height}, text: ${resolved}`);
  } finally {
    await server.stop();
    copy.stop();
  }
});
