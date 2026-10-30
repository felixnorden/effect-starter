// @effect-diagnostics asyncFunction:off
/**
 * Slice 7's browser evidence: the session member drives title, header, layout,
 * theme mode and the two configured sheets.
 */
import { expect, test } from "@playwright/test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { startEditorPage } from "../e2e/preview-server.ts";

const value = (key: string, entry: unknown, source = `setup:${key}`) => ({
  key,
  value: entry,
  source,
});

const documentText = "# Session\n\n```js\nconst answer = 42;\n```\n";

const cssFile = (name: string, css: string): { dir: string; path: string } => {
  const dir = mkdtempSync(join(tmpdir(), "mdv-session-"));
  const path = join(dir, name);
  writeFileSync(path, css);
  return { dir, path };
};

test("a template and hidden header render as configured", async ({ page }) => {
  const server = await startEditorPage({
    configuration: [
      value("preview.page_title", "「${name}」"),
      value("preview.show_filename", false),
    ],
    document: { path: join(tmpdir(), "notes.md"), text: documentText },
  });

  try {
    await page.goto(server.url);
    await page.waitForSelector(".preview-title");

    await expect(page.locator(".preview-title")).toHaveText("「notes.md」");
    await expect(page.locator(".preview-file-name")).toHaveCount(0);
  } finally {
    await server.stop();
  }
});

test("width and font size change the computed layout", async ({ page }) => {
  const server = await startEditorPage({
    configuration: [value("preview.width", "640px"), value("preview.font_size", "22px")],
    document: { path: join(tmpdir(), "notes.md"), text: documentText },
  });

  try {
    await page.goto(server.url);
    await page.waitForSelector(".preview-body");

    const metrics = await page.locator(".preview-body").evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        width: style.getPropertyValue("--preview-width").trim(),
        fontSize: style.getPropertyValue("--preview-font-size").trim(),
        computedFontSize: style.fontSize,
      };
    });

    expect(metrics.width).toBe("640px");
    expect(metrics.fontSize).toBe("22px");
    expect(metrics.computedFontSize).toBe("22px");
  } finally {
    await server.stop();
  }
});

test("a configured theme applies and a manual toggle survives a reload", async ({ page }) => {
  const server = await startEditorPage({
    configuration: [value("theme.mode", "light")],
    document: { path: join(tmpdir(), "notes.md"), text: documentText },
  });

  try {
    await page.goto(server.url);
    await page.waitForSelector(".preview-theme-toggle");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

    await page.getByRole("button", { name: "Dark" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

    await page.reload();
    await page.waitForSelector(".preview-theme-toggle");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  } finally {
    await server.stop();
  }
});

test("a configured code sheet wins over the theme sheet in both modes", async ({ page }) => {
  const code = cssFile("code.css", ".preview-body pre code { outline-color: rgb(1, 2, 3); }\n");
  const server = await startEditorPage({
    configuration: [value("theme.code_css", code.path), value("theme.mode", "light")],
    document: { path: join(tmpdir(), "notes.md"), text: documentText },
  });

  try {
    await page.goto(server.url);
    await page.waitForSelector(".preview-body pre code");

    const slots = await page
      .locator("link[rel=stylesheet]")
      .evaluateAll((links) => links.map((link) => link.getAttribute("data-slot")));
    expect(slots.indexOf("code")).toBeGreaterThan(slots.indexOf("light"));
    expect(slots.indexOf("code")).toBeGreaterThan(slots.indexOf("dark"));

    const color = await page
      .locator(".preview-body pre code")
      .evaluate((element) => getComputedStyle(element).outlineColor);
    expect(color).toBe("rgb(1, 2, 3)");

    await page.getByRole("button", { name: "Dark" }).click();
    const after = await page
      .locator(".preview-body pre code")
      .evaluate((element) => getComputedStyle(element).outlineColor);
    expect(after).toBe("rgb(1, 2, 3)");
  } finally {
    await server.stop();
    rmSync(code.dir, { recursive: true, force: true });
  }
});

test("editing the configured CSS and reloading applies the new rule", async ({ page }) => {
  const code = cssFile("code.css", ".preview-body pre code { outline-color: rgb(4, 5, 6); }\n");
  const server = await startEditorPage({
    configuration: [value("theme.code_css", code.path)],
    document: { path: join(tmpdir(), "notes.md"), text: documentText },
  });

  try {
    await page.goto(server.url);
    await page.waitForSelector(".preview-body pre code");
    await expect(page.locator("link[data-slot=code]")).toHaveCount(1);
    const before = await page.locator("link[data-slot=code]").getAttribute("href");

    writeFileSync(code.path, ".preview-body pre code { outline-color: rgb(7, 8, 9); }\n");
    await page.reload();
    await page.waitForSelector(".preview-body pre code");
    await expect(page.locator("link[data-slot=code]")).not.toHaveAttribute("href", before ?? "");

    await expect
      .poll(() =>
        page
          .locator(".preview-body pre code")
          .evaluate((element) => getComputedStyle(element).outlineColor),
      )
      .toBe("rgb(7, 8, 9)");
  } finally {
    await server.stop();
    rmSync(code.dir, { recursive: true, force: true });
  }
});

test("the page keeps its built-in sheet when the configured address is null", async ({ page }) => {
  const server = await startEditorPage({
    configuration: [value("theme.markdown_css", "/definitely/missing.css")],
    document: { path: join(tmpdir(), "notes.md"), text: documentText },
  });

  try {
    await page.goto(server.url);
    await page.waitForSelector(".preview-body");

    await expect(page.locator("link[data-slot=markdown]")).toHaveCount(0);
    await expect(page.locator("link[data-slot=light]")).toHaveCount(1);
  } finally {
    await server.stop();
  }
});
