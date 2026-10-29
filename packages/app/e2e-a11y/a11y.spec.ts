// @effect-diagnostics asyncFunction:off
/**
 * AR-1's browser evidence: axe-core over the rendered page, outside
 * `bun run check`. Every fixture is copied to a temporary path first.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { copyFixture, startPreview } from "../e2e/preview-server.ts";

const TAGS = ["wcag2a", "wcag2aa", "best-practice"];

const BAR_NAMES = [
  "Dark mode",
  "Page theme",
  "Light code theme",
  "Dark code theme",
  "Line numbers",
  "Reading width",
  "Font scale",
] as const;

const AFFORDANCE_PREFIXES = ["Copy address of", "Copy link to"] as const;

type Ring = {
  readonly tag: string;
  readonly name: string;
  readonly inBody: boolean;
  readonly outlineWidth: number;
  readonly outlineStyle: string;
};

const ringOf = (page: Page): Promise<Ring | null> =>
  page.evaluate(() => {
    const active = document.activeElement;
    if (!(active instanceof HTMLElement)) return null;
    const style = getComputedStyle(active);
    return {
      tag: active.tagName.toLowerCase(),
      name: active.getAttribute("aria-label") ?? (active.textContent ?? "").trim(),
      inBody: active.closest(".preview-body") !== null,
      outlineWidth: Number.parseFloat(style.outlineWidth),
      outlineStyle: style.outlineStyle,
    };
  });

const withDocument = async (
  page: Page,
  fixture: string,
  run: () => Promise<void>,
): Promise<void> => {
  const copy = copyFixture(fixture);
  const server = await startPreview(copy.file);

  try {
    await page.goto(server.url);
    await page.waitForSelector("[data-block-id]");
    await run();
  } finally {
    await server.stop();
    copy.stop();
  }
};

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

test("every bar control passes axe and shows a visible focus ring", async ({ page }) => {
  await withDocument(page, "fixtures/kitchen-sink.md", async () => {
    const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
    console.log(`axe bar: ${results.violations.length} violations`);
    expect(results.violations).toEqual([]);

    await page.evaluate(() => {
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    });

    const rings: Ring[] = [];
    for (let index = 0; index < 16; index += 1) {
      await page.keyboard.press("Tab");
      const ring = await ringOf(page);
      if (ring === null) continue;
      rings.push(ring);
      if (ring.inBody && ring.tag === "a") break;
    }

    const bar = rings.filter((ring) => !ring.inBody);
    expect(bar.map((ring) => ring.name).toSorted()).toEqual([...BAR_NAMES].toSorted());

    const link = rings.find((ring) => ring.inBody && ring.tag === "a");
    expect(link, "Tab reaches one document link").toBeDefined();

    for (const ring of rings) {
      expect(ring.outlineWidth, `${ring.name} outline width`).toBeGreaterThan(0);
      expect(ring.outlineStyle, `${ring.name} outline style`).not.toBe("none");
    }
  });
});

test("the bar names are distinct and disjoint from the affordance names", async ({ page }) => {
  await withDocument(page, "fixtures/kitchen-sink.md", async () => {
    const names = await page.evaluate(() =>
      [...document.querySelectorAll(".preview-header button, .preview-header select")].map(
        (control) => control.getAttribute("aria-label") ?? (control.textContent ?? "").trim(),
      ),
    );

    expect(new Set(names).size).toBe(7);
    for (const name of BAR_NAMES) expect(names).toContain(name);
    for (const name of names) {
      expect(name.startsWith("Copy "), `${name} is not an affordance`).toBe(false);
      for (const prefix of AFFORDANCE_PREFIXES) expect(name.startsWith(prefix)).toBe(false);
    }
  });
});

test("the bar wraps instead of clipping at a narrow viewport", async ({ page }) => {
  const measure = (): Promise<{ boxes: readonly [number, number][]; height: number }> =>
    page.evaluate(() => {
      const bar = document.querySelector(".preview-header");
      const controls = [
        ...document.querySelectorAll(".preview-header button, .preview-header select"),
      ];
      return {
        boxes: controls.map((control) => {
          const box = control.getBoundingClientRect();
          return [box.left, box.right] as const;
        }),
        height: bar?.getBoundingClientRect().height ?? 0,
      };
    });

  await withDocument(page, "fixtures/kitchen-sink.md", async () => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const wide = await measure();

    await page.setViewportSize({ width: 360, height: 800 });
    const narrow = await measure();
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);

    console.log(`bar height: wide ${wide.height}, narrow ${narrow.height}`);
    for (const [left, right] of narrow.boxes) {
      expect(left).toBeGreaterThanOrEqual(0);
      expect(right).toBeLessThanOrEqual(360.5);
    }
    expect(narrow.height).toBeGreaterThan(wide.height);
    expect(scrollWidth).toBeLessThanOrEqual(360);
  });
});
