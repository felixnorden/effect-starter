// @effect-diagnostics asyncFunction:off
/**
 * AS-3's network proof: under the blocked policy no image can request a
 * non-local host, and the page shows one placeholder per authored image.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

import { copyFixture, startPreview } from "./preview-server.ts";

const here = fileURLToPath(new URL(".", import.meta.url));
const repo = resolve(here, "../../..");
const helper = resolve(here, "render-block-mode.ts");
const fixture = resolve(repo, "fixtures/render-fidelity/images-blocked.md");

const localOnly = (url: string): boolean => {
  if (url.startsWith("data:") || url.startsWith("about:") || url.startsWith("blob:")) return false;
  try {
    return new URL(url).hostname === "127.0.0.1";
  } catch {
    return true;
  }
};

test("block mode makes no non-local request and shows one placeholder per image", async ({
  page,
}) => {
  const html = execFileSync("bun", [helper, fixture], { cwd: repo, encoding: "utf8" });
  const requests: string[] = [];
  await page.route("**/*", (route) => {
    requests.push(route.request().url());
    return route.abort();
  });

  await page.setContent(html);
  await page.waitForSelector("[data-mdv-placeholder]");

  const external = requests.filter((url) => !localOnly(url) && !url.startsWith("file:"));
  expect(external, "no request leaves the page origin").toEqual([]);

  const placeholders = await page.locator("[data-mdv-placeholder]").count();
  const authored = (readFileSync(fixture, "utf8").match(/!\[/gu) ?? []).length;
  expect(placeholders).toBe(authored);
  expect(await page.locator("img[src]").count()).toBe(0);
});

test("renders a remote image by default", async ({ page }) => {
  const copy = copyFixture("fixtures/render-fidelity/images-remote.md");
  const server = await startPreview(copy.file);
  const remote = "https://example.com/**";
  const hits: string[] = [];
  const pixel = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );

  await page.route(remote, (route) => {
    hits.push(route.request().url());
    return route.fulfill({ status: 200, contentType: "image/png", body: pixel });
  });

  try {
    await page.goto(server.url);
    await page.waitForSelector("img[data-mdv-source]");

    expect(hits).toHaveLength(1);
    expect(await page.locator("img[data-mdv-source]").count()).toBe(1);
  } finally {
    await server.stop();
    copy.stop();
  }
});
