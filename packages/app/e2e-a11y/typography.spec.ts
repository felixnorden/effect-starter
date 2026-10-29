// @effect-diagnostics asyncFunction:off
/**
 * TH-10's browser evidence: the prose layer's computed result. Preflight
 * removes the browser's element typography, so this spec samples the scale,
 * the rhythm, the markers, the link decoration, and the inline surfaces the
 * app stylesheet authors.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { copyFixture, startPreview } from "../e2e/preview-server.ts";

const TYPOGRAPHY = "fixtures/render-fidelity/typography.md";
const AXE_FIXTURES = [
  { fixture: "fixtures/kitchen-sink.md", disabled: [] },
  { fixture: "fixtures/render-fidelity/toc.md", disabled: [] },
  // The source skips a heading level; `a11y.spec.ts` accepts the same finding.
  { fixture: "fixtures/render-fidelity/heading-structure.md", disabled: ["heading-order"] },
] as const;
const TAGS = ["wcag2a", "wcag2aa", "best-practice"];

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

/** A probe makes the browser resolve a role alias to its computed colour. */
const roleColour = (page: Page, role: string): Promise<string> =>
  page.evaluate((name) => {
    const probe = document.createElement("div");
    probe.style.color = `var(${name})`;
    document.body.append(probe);
    const colour = getComputedStyle(probe).color;
    probe.remove();
    return colour;
  }, role);

test("headings sit above body text and below the page title", async ({ page }) => {
  await withDocument(page, TYPOGRAPHY, async () => {
    const sizes = await page.evaluate(() => {
      const size = (selector: string): number => {
        const element = document.querySelector(selector);
        return element === null ? 0 : Number.parseFloat(getComputedStyle(element).fontSize);
      };
      return {
        title: size(".preview-title"),
        h2: size(".preview-body h2"),
        h3: size(".preview-body h3"),
        body: size(".preview-body p"),
      };
    });

    console.log(`sizes: title ${sizes.title} h2 ${sizes.h2} h3 ${sizes.h3} body ${sizes.body}`);
    expect(sizes.title).toBeGreaterThan(sizes.h2);
    expect(sizes.h2).toBeGreaterThan(sizes.h3);
    expect(sizes.h3).toBeGreaterThan(sizes.body);

    const muted = await roleColour(page, "--color-muted");
    const h6 = await page.evaluate(() => {
      const element = document.querySelector(".preview-body h6");
      return element === null ? "" : getComputedStyle(element).color;
    });
    expect(h6).toBe(muted);
  });
});

test("lists keep markers and indentation", async ({ page }) => {
  await withDocument(page, TYPOGRAPHY, async () => {
    const lists = await page.evaluate(() => {
      const unordered = document.querySelector(".preview-body ul");
      const ordered = document.querySelector(".preview-body ol");
      const item = unordered?.querySelector("li") ?? null;
      return {
        unordered: unordered === null ? "" : getComputedStyle(unordered).listStyleType,
        ordered: ordered === null ? "" : getComputedStyle(ordered).listStyleType,
        padding:
          unordered === null
            ? 0
            : Number.parseFloat(getComputedStyle(unordered).paddingInlineStart),
        marker: item === null ? "" : getComputedStyle(item, "::marker").color,
      };
    });

    console.log(`list styles: ${lists.unordered} / ${lists.ordered}, marker ${lists.marker}`);
    expect(lists.unordered).toBe("disc");
    expect(lists.ordered).toBe("decimal");
    expect(lists.padding).toBeGreaterThanOrEqual(20);
    expect(lists.marker).not.toBe("");
    expect(lists.marker).not.toBe("rgba(0, 0, 0, 0)");
  });
});

test("paragraphs and blocks keep a rhythm", async ({ page }) => {
  await withDocument(page, TYPOGRAPHY, async () => {
    const rhythm = await page.evaluate(() => {
      const margin = (element: Element | null): number =>
        element === null ? 0 : Number.parseFloat(getComputedStyle(element).marginBlockStart);
      return {
        second: margin([...document.querySelectorAll(".preview-body p")][1] ?? null),
        fence: margin(document.querySelector(".preview-body pre")),
        first: margin(document.querySelector(".preview-body [data-block-id]:first-child > *")),
      };
    });

    console.log(
      `rhythm: second paragraph ${rhythm.second}, fence ${rhythm.fence}, first ${rhythm.first}`,
    );
    expect(rhythm.second).toBeGreaterThan(0);
    expect(rhythm.fence).toBeGreaterThan(0);
    expect(rhythm.first).toBe(0);
  });
});

test("links are underlined and never colour-only", async ({ page }) => {
  await withDocument(page, TYPOGRAPHY, async () => {
    const link = await page.evaluate(() => {
      const anchor = document.querySelector(".preview-body a");
      const style = anchor === null ? null : getComputedStyle(anchor);
      return { decoration: style?.textDecorationLine ?? "", colour: style?.color ?? "" };
    });

    console.log(`link: ${link.decoration} ${link.colour}`);
    expect(link.decoration).toContain("underline");
    expect(link.colour).toBe(await roleColour(page, "--color-accent"));
  });
});

test("inline code and table headers carry a surface", async ({ page }) => {
  await withDocument(page, TYPOGRAPHY, async () => {
    const sample = await page.evaluate(() => {
      const code = document.querySelector(".preview-body p code");
      const header = document.querySelector(".preview-body th");
      return {
        codeBackground: code === null ? "" : getComputedStyle(code).backgroundColor,
        headerWeight:
          header === null ? 0 : Number.parseInt(getComputedStyle(header).fontWeight, 10),
        headerBackground: header === null ? "" : getComputedStyle(header).backgroundColor,
        pageBackground: getComputedStyle(document.body).backgroundColor,
      };
    });

    console.log(`surfaces: code ${sample.codeBackground}, th ${sample.headerBackground}`);
    expect(sample.codeBackground).not.toBe("rgba(0, 0, 0, 0)");
    expect(sample.headerWeight).toBeGreaterThanOrEqual(600);
    expect(sample.headerBackground).not.toBe("rgba(0, 0, 0, 0)");
    expect(sample.headerBackground).not.toBe(sample.pageBackground);
  });
});

for (const { fixture, disabled } of AXE_FIXTURES) {
  test(`axe reports no structural violation on the styled ${fixture}`, async ({ page }) => {
    await withDocument(page, fixture, async () => {
      const results = await new AxeBuilder({ page })
        .withTags(TAGS)
        .disableRules([...disabled])
        .analyze();
      console.log(`axe ${fixture}: ${results.violations.length} violations`);
      expect(results.violations).toEqual([]);
    });
  });
}
