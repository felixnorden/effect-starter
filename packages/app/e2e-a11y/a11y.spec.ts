// @effect-diagnostics asyncFunction:off
/**
 * AR-1's browser evidence: axe-core over the rendered page, outside
 * `bun run check`. Every fixture is copied to a temporary path first.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";

import { copyFixture, startPreview } from "../e2e/preview-server.ts";
import { openPanel, PANEL_TOGGLE } from "./panel.ts";

const TAGS = ["wcag2a", "wcag2aa", "best-practice"];

const PANEL_NAMES = [
  "Dark mode",
  "Page theme",
  "Narrow",
  "Normal",
  "Wide",
  "Small",
  // One per axis: the width join and the scale join each offer a "Normal".
  "Normal",
  "Large",
  "Code theme",
  "Line numbers",
] as const;

/** The header's one control, which opens and closes the panel. */
const CHROME_NAMES = [...PANEL_NAMES, PANEL_TOGGLE] as const;

const AFFORDANCE_PREFIXES = ["Copy link to"] as const;

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
  run: (url: string) => Promise<void>,
): Promise<void> => {
  const copy = copyFixture(fixture);
  const server = await startPreview(copy.file);

  try {
    await page.goto(server.url);
    await page.waitForSelector("[data-block-id]");
    await run(server.url);
  } finally {
    await server.stop();
    copy.stop();
  }
};

const TYPOGRAPHY = "fixtures/render-fidelity/typography.md";

type Affordance = {
  readonly kind: "heading" | "link" | "table" | "code";
  readonly name: string;
  readonly payload: (url: string) => string;
};

const AFFORDANCES: readonly Affordance[] = [
  {
    kind: "heading",
    name: "Copy link to Section Heading",
    payload: (url) => new URL("#section-heading", url).href,
  },
  { kind: "table", name: "Copy table", payload: () => "Name\tValue\none\t1\ntwo\t2" },
  { kind: "code", name: "Copy code", payload: () => "const answer = 42;\n" },
];

/** The hidden surface is the cluster for block kinds and the control itself otherwise. */
const surfaceOpacity = (control: Locator): Promise<number> =>
  control.evaluate((element) => {
    const surface = element.closest("[data-mdv-actions]") ?? element;
    return Number.parseFloat(getComputedStyle(surface).opacity);
  });

/** One helper for all three kinds: present, hidden, revealed, named, copying. */
const expectAffordance = async (page: Page, url: string, affordance: Affordance): Promise<void> => {
  const control = page.getByRole("button", { name: affordance.name, exact: true });
  await expect(control, `${affordance.kind} exists before hover`).toHaveCount(1);
  expect(await surfaceOpacity(control), `${affordance.kind} is hidden before hover`).toBe(0);

  const container = page.locator(`[data-block-id]:has([aria-label="${affordance.name}"])`).first();
  await container.hover();
  await expect.poll(() => surfaceOpacity(control)).toBe(1);

  await control.click();
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toBe(affordance.payload(url));

  if (affordance.kind === "code" || affordance.kind === "table") {
    // The block actions are icons now: success swaps the glyph, not the text.
    await expect(control).toHaveAttribute("data-mdv-state", "copied");
    await expect(control.locator('[data-mdv-icon="check"]')).toBeVisible();
    await expect(control.locator('[data-mdv-icon="copy"]')).toBeHidden();
    await expect(control).not.toHaveText("Copied");
  } else {
    await expect(control).toHaveAttribute("data-mdv-state", "copied");
  }
};

test.use({ permissions: ["clipboard-read", "clipboard-write"] });

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

test("every panel control passes axe and shows a visible focus ring", async ({ page }) => {
  await withDocument(page, "fixtures/kitchen-sink.md", async () => {
    await openPanel(page);
    // Reload so the tab walk starts at the document, not at the clicked toggle.
    await page.reload();
    await page.waitForSelector("[data-block-id]");
    await expect(page.locator("#preview-panel")).toHaveAttribute("data-state", "open");

    const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
    console.log(`axe panel: ${results.violations.length} violations`);
    expect(results.violations).toEqual([]);

    await page.evaluate(() => {
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    });

    const rings: Ring[] = [];
    for (let index = 0; index < 20; index += 1) {
      await page.keyboard.press("Tab");
      const ring = await ringOf(page);
      if (ring === null) continue;
      rings.push(ring);
      if (ring.inBody && ring.tag === "a") break;
    }

    const chrome = rings.filter((ring) => !ring.inBody);
    expect(chrome.map((ring) => ring.name).toSorted()).toEqual([...CHROME_NAMES].toSorted());
    expect(chrome[0]?.name, "the panel toggle comes first").toBe(PANEL_TOGGLE);

    const link = rings.find((ring) => ring.inBody && ring.tag === "a");
    expect(link, "Tab reaches one document link").toBeDefined();

    for (const ring of rings) {
      expect(ring.outlineWidth, `${ring.name} outline width`).toBeGreaterThan(0);
      expect(ring.outlineStyle, `${ring.name} outline style`).not.toBe("none");
    }
  });
});

test("the panel names are distinct and disjoint from the affordance names", async ({ page }) => {
  await withDocument(page, "fixtures/kitchen-sink.md", async () => {
    await openPanel(page);

    const names = await page.evaluate(() =>
      [...document.querySelectorAll(".preview-sidebar button, .preview-sidebar select")].map(
        (control) => control.getAttribute("aria-label") ?? (control.textContent ?? "").trim(),
      ),
    );

    // The exact multiset: two joins, three selects, two switches, one toggle.
    const expected = [...PANEL_NAMES, PANEL_TOGGLE].toSorted();
    expect(names.toSorted()).toEqual(expected);
    expect(new Set(names).size, "no name repeats outside the two joins").toBe(
      new Set(expected).size,
    );
    for (const name of PANEL_NAMES) expect(names).toContain(name);
    expect(names).toContain(PANEL_TOGGLE);
    for (const name of names) {
      expect(name.startsWith("Copy "), `${name} is not an affordance`).toBe(false);
      for (const prefix of AFFORDANCE_PREFIXES) expect(name.startsWith(prefix)).toBe(false);
    }
  });
});

test("Tab reaches one control per kind and each is visible while focused", async ({ page }) => {
  const KINDS = ["Copy link to", "Copy table", "Copy code"] as const;

  await withDocument(page, "fixtures/render-fidelity/typography.md", async () => {
    const seen = new Map<string, { readonly opacity: number; readonly inViewport: boolean }>();

    for (let index = 0; index < 60 && seen.size < KINDS.length; index += 1) {
      await page.keyboard.press("Tab");
      const label = await page.evaluate(
        () => document.activeElement?.getAttribute("aria-label") ?? "",
      );
      if (!label.startsWith("Copy ")) continue;

      await page.waitForFunction(() => {
        const active = document.activeElement;
        return (
          active instanceof HTMLElement && Number.parseFloat(getComputedStyle(active).opacity) === 1
        );
      });

      const state = await page.evaluate(() => {
        const active = document.activeElement;
        if (!(active instanceof HTMLElement)) return null;
        const box = active.getBoundingClientRect();
        return {
          opacity: Number.parseFloat(getComputedStyle(active).opacity),
          inViewport:
            box.width > 0 &&
            box.height > 0 &&
            box.left >= -0.5 &&
            box.right <= window.innerWidth + 0.5 &&
            box.top >= -0.5 &&
            box.bottom <= window.innerHeight + 0.5,
        };
      });
      if (state === null) continue;

      const kind = KINDS.find((prefix) => label.startsWith(prefix));
      if (kind !== undefined) seen.set(kind, state);
    }

    expect([...seen.keys()].toSorted()).toEqual([...KINDS].toSorted());
    for (const [kind, state] of seen) {
      expect(state.opacity, `${kind} is visible while focused`).toBe(1);
      expect(state.inViewport, `${kind} lies inside the viewport`).toBe(true);
    }
  });
});

test("copy controls sit inside their block, beside or over the content", async ({ page }) => {
  await withDocument(page, "fixtures/kitchen-sink.md", async () => {
    const boxes = await page.evaluate(() => {
      const measure = (kind: string, selector: string, owner: string) => {
        const control = document.querySelector(selector);
        if (control === null) return null;
        const box = control.getBoundingClientRect();
        const container = control.closest(owner)?.getBoundingClientRect();
        const text = control.parentElement?.querySelector("h2, h3, h4, h5, h6");
        return {
          kind,
          width: box.width,
          height: box.height,
          rightGap: (container?.right ?? 0) - box.right,
          topGap: box.top - (container?.top ?? 0),
          textGap:
            text === null || text === undefined
              ? null
              : box.left - text.getBoundingClientRect().right,
        };
      };

      return [
        measure("code", "[data-mdv-copy-code]", "[data-block-id]"),
        measure("table", "[data-mdv-copy-table]", "[data-block-id]"),
        measure("heading", "[data-mdv-copy-link]", "[data-block-id]"),
      ];
    });

    const found = boxes.filter((entry) => entry !== null);
    expect(found.map((entry) => entry.kind).toSorted()).toEqual(["code", "heading", "table"]);

    for (const entry of found) {
      // A square, a little larger than the old chip.
      expect(entry.width, `${entry.kind} width`).toBeGreaterThanOrEqual(31.5);
      expect(entry.height, `${entry.kind} height`).toBeGreaterThanOrEqual(31.5);
      // Inside the block's box, at its top.
      expect(entry.topGap, `${entry.kind} top gap`).toBeLessThanOrEqual(9);
      expect(entry.topGap, `${entry.kind} top gap`).toBeGreaterThanOrEqual(-1);
    }

    // The heading control follows the text; the block controls hug the corner.
    const heading = found.find((entry) => entry.kind === "heading");
    expect(heading?.textGap ?? -1).toBeGreaterThanOrEqual(0);
    expect(heading?.textGap ?? 99).toBeLessThanOrEqual(12);
    for (const entry of found.filter((one) => one.kind !== "heading")) {
      expect(entry.rightGap, `${entry.kind} right gap`).toBeGreaterThanOrEqual(-1);
      expect(entry.rightGap, `${entry.kind} right gap`).toBeLessThanOrEqual(9);
    }

    console.log(
      `copy controls: ${found.map((entry) => `${entry.kind} ${Math.round(entry.width)}x${Math.round(entry.height)} right ${Math.round(entry.rightGap)} top ${Math.round(entry.topGap)}${entry.textGap === null ? "" : ` after text ${Math.round(entry.textGap)}`}`).join("; ")}`,
    );
  });
});

test("the panel and the affordances expose distinct, stable names", async ({ page }) => {
  await withDocument(page, TYPOGRAPHY, async () => {
    const affordanceNames = await page.evaluate(() =>
      [
        ...document.querySelectorAll(
          "[data-mdv-copy-code], [data-mdv-copy-table], [data-mdv-copy-link]",
        ),
      ].map((control) => control.getAttribute("aria-label") ?? ""),
    );

    expect(affordanceNames).toEqual(expect.arrayContaining(["Copy code", "Copy table"]));
    expect(affordanceNames.some((name) => name.startsWith("Copy link to"))).toBe(true);
    expect(affordanceNames.some((name) => name.startsWith("Copy address of"))).toBe(false);

    const all = [...new Set(CHROME_NAMES), ...affordanceNames];
    expect(new Set(all).size, `distinct names: ${all.join(" | ")}`).toBe(all.length);
  });
});

for (const affordance of AFFORDANCES) {
  test(`the ${affordance.kind} affordance copies its payload`, async ({ page }) => {
    await withDocument(page, TYPOGRAPHY, async (url) => {
      await expectAffordance(page, url, affordance);
    });
  });
}

test("the floating panel rests as a rail and never narrows the document", async ({ page }) => {
  await withDocument(page, "fixtures/kitchen-sink.md", async () => {
    const toggle = page.getByRole("button", { name: PANEL_TOGGLE, exact: true });
    const panel = page.locator("#preview-panel");
    const paper = () =>
      page.locator(".preview-body").evaluate((element) => element.getBoundingClientRect().width);

    // A first visit rests as a rail: the paper keeps the full measure.
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(panel).toHaveAttribute("data-state", "rail");
    await expect(page.locator(".preview-sidebar select")).toHaveCount(0);
    await expect(toggle).toBeVisible();
    await expect(page.getByRole("button", { name: "Dark mode" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Line numbers" })).toBeVisible();
    const railPaper = await paper();

    const box = (): Promise<{ gap: number; width: number; height: number; fixed: boolean }> =>
      panel.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return {
          gap: window.innerWidth - rect.right,
          width: rect.width,
          height: rect.height,
          fixed: getComputedStyle(element).position === "fixed",
        };
      });
    const rail = await box();
    expect(rail.fixed).toBe(true);
    expect(rail.gap).toBeCloseTo(16, 0);
    expect(rail.width).toBeLessThan(64);
    expect(rail.width).toBeGreaterThan(32);
    // The rail is content-sized, never a full-height column.
    expect(rail.height).toBeLessThan(240);

    await openPanel(page);
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator(".preview-sidebar select")).toHaveCount(2);
    // The width travels; measure once it settles so the card is not mid-morph.
    await expect.poll(async () => (await box()).width).toBeGreaterThan(280);
    const open = await box();
    const viewport = await page.evaluate(() => window.innerHeight);
    const openPaper = await paper();
    console.log(
      `panel floats at the screen edge; rail ${Math.round(rail.width)}x${Math.round(rail.height)}, open ${Math.round(open.width)}x${Math.round(open.height)} of ${viewport}; paper ${Math.round(railPaper)}px rail and ${Math.round(openPaper)}px open`,
    );
    expect(openPaper).toBe(railPaper);
    expect(open.height).toBeGreaterThan(rail.height);
    expect(open.height).toBeLessThan(viewport);

    await toggle.click();
    await expect(panel).toHaveAttribute("data-state", "rail");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(await page.evaluate(() => sessionStorage.getItem("preview-sidebar"))).toBe("rail");

    await page.reload();
    await page.waitForSelector("[data-block-id]");
    await expect(panel).toHaveAttribute("data-state", "rail");

    await openPanel(page);
    expect(await page.evaluate(() => sessionStorage.getItem("preview-sidebar"))).toBe("open");
  });
});

test("the reading joins apply and remember the chosen preset", async ({ page }) => {
  await withDocument(page, "fixtures/kitchen-sink.md", async () => {
    await openPanel(page);
    const paper = () =>
      page.locator(".preview-body").evaluate((element) => element.getBoundingClientRect().width);
    const width = page.getByRole("group", { name: "Reading width" });
    const scale = page.getByRole("group", { name: "Font scale" });
    const wide = width.getByRole("button", { name: "Wide", exact: true });

    const normal = await paper();
    expect(normal).toBeGreaterThan(0);
    await expect(wide).toHaveAttribute("aria-pressed", "false");
    await wide.click();
    await expect(wide).toHaveAttribute("aria-pressed", "true");
    await expect.poll(paper, "a wider preset widens the document").toBeGreaterThan(normal);
    expect(await page.evaluate(() => sessionStorage.getItem("preview-width"))).toBe("wide");

    await scale.getByRole("button", { name: "Large", exact: true }).click();
    expect(await page.evaluate(() => sessionStorage.getItem("preview-scale"))).toBe("large");
    console.log(
      `reading joins: paper ${Math.round(normal)}px normal, ${Math.round(await paper())}px wide`,
    );

    await page.reload();
    await page.waitForSelector("[data-block-id]");
    await expect(page.locator("#preview-panel")).toHaveAttribute("data-state", "open");
    await expect(
      page.getByRole("group", { name: "Reading width" }).getByRole("button", {
        name: "Wide",
        exact: true,
      }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(
      page.getByRole("group", { name: "Font scale" }).getByRole("button", {
        name: "Large",
        exact: true,
      }),
    ).toHaveAttribute("aria-pressed", "true");
  });
});

test("the card morphs its width and height together instead of popping", async ({ page }) => {
  await withDocument(page, "fixtures/kitchen-sink.md", async () => {
    const panel = page.locator("#preview-panel");
    const rail = await panel.evaluate((element) => element.getBoundingClientRect().height);
    const railToggle = await panel.evaluate(
      (element) =>
        element.querySelector(".preview-panel-toggle")?.getBoundingClientRect().left ?? 0,
    );

    // Sample every frame from the click: the box, the toggle's edge, and
    // whether the body has started to appear.
    const frames = await panel.evaluate(async (element) => {
      const samples: {
        width: number;
        height: number;
        toggleLeft: number;
        body: number | null;
      }[] = [];
      const toggle = element.querySelector<HTMLElement>(".preview-panel-toggle");
      toggle?.click();
      await new Promise<void>((resolve) => {
        const start = performance.now();
        const tick = (): void => {
          const box = element.getBoundingClientRect();
          const button = toggle?.getBoundingClientRect();
          const group = element.querySelector(".preview-group");
          samples.push({
            width: box.width,
            height: box.height,
            toggleLeft: button?.left ?? box.left,
            body: group === null ? null : Number(getComputedStyle(group).opacity),
          });
          if (performance.now() - start < 320) requestAnimationFrame(tick);
          else resolve();
        };
        requestAnimationFrame(tick);
      });
      return samples;
    });

    const open = frames.at(-1);
    expect(open).toBeDefined();
    const openHeight = open?.height ?? 0;
    const openWidth = open?.width ?? 0;
    const heights = frames.map((frame) => frame.height);

    // The box is taller than the rail, and no frame overshoots the settled box.
    expect(openHeight).toBeGreaterThan(rail + 8);
    expect(Math.max(...heights)).toBeLessThanOrEqual(openHeight + 1);
    // The height travels: some frame sits between the two sizes.
    expect(
      frames.some((frame) => frame.height > rail + 8 && frame.height < openHeight - 8),
      `heights: ${heights.map((height) => Math.round(height)).join(",")}`,
    ).toBe(true);

    // Width grows monotonically, and the toggle starts where it was: no hop.
    for (const [index, frame] of frames.entries()) {
      if (index === 0) continue;
      expect(frame.width, `frame ${index} width`).toBeGreaterThanOrEqual(
        (frames[index - 1]?.width ?? 0) - 1,
      );
      expect(
        Math.abs(frame.toggleLeft - (frames[index - 1]?.toggleLeft ?? 0)),
        `frame ${index} toggle step`,
      ).toBeLessThanOrEqual(6);
    }
    expect(Math.abs((frames[0]?.toggleLeft ?? 0) - railToggle)).toBeLessThanOrEqual(2);

    // The body waits for the box: while the card is still small, nothing shows.
    for (const frame of frames) {
      if (frame.width < openWidth * 0.9) expect(frame.body ?? 0).toBeLessThan(0.1);
    }

    await expect
      .poll(() => panel.evaluate((element) => element.getBoundingClientRect().height))
      .toBeCloseTo(openHeight, 0);
    // Clipping is only for the morph: the card scrolls again once it settles.
    await expect(panel).not.toHaveAttribute("data-morphing");
    console.log(
      `panel morph: rail ${Math.round(rail)} -> open ${Math.round(openWidth)}x${Math.round(openHeight)} over ${frames.length} frames`,
    );
  });
});

test("the card floats over the document at a narrow viewport and closes on Escape or the backdrop", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await withDocument(page, "fixtures/kitchen-sink.md", async () => {
    const toggle = page.getByRole("button", { name: PANEL_TOGGLE, exact: true });
    const panel = page.locator("#preview-panel");

    // A first visit rests as a rail instead of covering the text.
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(panel).toHaveAttribute("data-state", "rail");
    await expect(toggle).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
      "the rail adds no horizontal scroll",
    ).toBeLessThanOrEqual(360);

    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    // Wait for the width transition, then every control is inside the card.
    await expect
      .poll(() => panel.evaluate((element) => element.getBoundingClientRect().width))
      .toBeGreaterThan(300);

    const boxes = await page.evaluate(() =>
      [...document.querySelectorAll(".preview-sidebar button, .preview-sidebar select")].map(
        (control) => {
          const box = control.getBoundingClientRect();
          return [box.left, box.right, box.top, box.bottom] as const;
        },
      ),
    );
    expect(boxes).toHaveLength(PANEL_NAMES.length + 1);
    for (const [left, right, top, bottom] of boxes) {
      expect(left).toBeGreaterThanOrEqual(0);
      expect(right).toBeLessThanOrEqual(360.5);
      expect(top).toBeGreaterThanOrEqual(0);
      expect(bottom).toBeLessThanOrEqual(800.5);
    }

    const height = await panel.evaluate((element) => element.getBoundingClientRect().height);
    console.log(`narrow card height: ${Math.round(height)} of 800`);
    expect(height).toBeLessThan(800);

    const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
    console.log(`axe card: ${results.violations.length} violations`);
    expect(results.violations).toEqual([]);

    await page.keyboard.press("Escape");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(panel).toHaveAttribute("data-state", "rail");

    await toggle.click();
    await expect(panel).toHaveAttribute("data-state", "open");
    await page.locator(".preview-backdrop").click({ position: { x: 10, y: 10 } });
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(panel).toHaveAttribute("data-state", "rail");
  });
});
