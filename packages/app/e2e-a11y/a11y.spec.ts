// @effect-diagnostics asyncFunction:off
/**
 * AR-1's browser evidence: axe-core over the rendered page, outside
 * `bun run check`. Every fixture is copied to a temporary path first.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import { copyFixture, startPreview } from "../e2e/preview-server.ts";

const TAGS = ["wcag2a", "wcag2aa", "best-practice"];

test("the rendered page reports no structural axe violation", async ({ page }) => {
  const copy = copyFixture("fixtures/kitchen-sink.md");
  const server = await startPreview(copy.file);

  try {
    await page.goto(server.url);
    await page.waitForSelector("[data-block-id]");

    const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
    console.log(`axe kitchen-sink: ${results.violations.length} violations`);
    expect(results.violations).toEqual([]);
  } finally {
    await server.stop();
    copy.stop();
  }
});

test("the TOC document keeps every landmark unique", async ({ page }) => {
  const copy = copyFixture("fixtures/render-fidelity/toc.md");
  const server = await startPreview(copy.file);

  try {
    await page.goto(server.url);
    await page.waitForSelector("[data-block-id]");

    const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
    console.log(`axe toc: ${results.violations.length} violations`);
    expect(results.violations).toEqual([]);
  } finally {
    await server.stop();
    copy.stop();
  }
});

test("a document that opens below h1 yields only the accepted heading-order finding", async ({
  page,
}) => {
  const copy = copyFixture("fixtures/render-fidelity/heading-structure.md");
  const server = await startPreview(copy.file);

  try {
    await page.goto(server.url);
    await page.waitForSelector("[data-block-id]");

    const withHeadingOrder = await new AxeBuilder({ page }).withTags(TAGS).analyze();
    const accepted = withHeadingOrder.violations.filter(
      (finding) => finding.id === "heading-order",
    );
    console.log(
      `accepted finding: heading-order x${accepted.length} on heading-structure (source skips a level)`,
    );

    const results = await new AxeBuilder({ page })
      .withTags(TAGS)
      .disableRules(["heading-order"])
      .analyze();
    expect(results.violations).toEqual([]);
  } finally {
    await server.stop();
    copy.stop();
  }
});
