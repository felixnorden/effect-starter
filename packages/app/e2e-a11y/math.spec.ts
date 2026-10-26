// @effect-diagnostics asyncFunction:off
/**
 * RD-4's browser evidence: math renders, the console stays clean, and no
 * request leaves the preview's origin. The fixture carries the malformed cases,
 * so the console clause is unconditional.
 */
import { expect, test } from "@playwright/test";

import { copyFixture, startPreview } from "../e2e/preview-server.ts";

test("math renders with a clean console and no remote request", async ({ page }) => {
  const copy = copyFixture("fixtures/render-fidelity/math.md");
  const server = await startPreview(copy.file);
  const consoleMessages: string[] = [];
  const requests: string[] = [];

  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") {
      consoleMessages.push(`${message.type()}: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => {
    consoleMessages.push(`pageerror: ${error.message}`);
  });
  page.on("request", (request) => requests.push(request.url()));

  try {
    await page.goto(server.url);
    await page.waitForSelector("[data-block-id]");
    await page.evaluate(
      () =>
        new Promise<void>((resolvePaint) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolvePaint())),
        ),
    );

    const origin = new URL(server.url).origin;
    const remote = requests.filter((url) => new URL(url).origin !== origin);
    const copies = await page.locator(".katex-html[aria-hidden]").count();

    console.log(
      `math: ${consoleMessages.length} console messages, ${remote.length} remote requests, ${copies} hidden math copies`,
    );
    for (const message of consoleMessages) console.log(`console: ${message}`);
    for (const url of remote) console.log(`remote request: ${url}`);

    expect(consoleMessages).toEqual([]);
    expect(remote).toEqual([]);
    expect(copies).toBeGreaterThan(0);
  } finally {
    await server.stop();
    copy.stop();
  }
});
