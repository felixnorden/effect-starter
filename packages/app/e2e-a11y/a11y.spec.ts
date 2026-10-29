// @effect-diagnostics asyncFunction:off
/**
 * AR-1's browser evidence: axe-core over the rendered page, outside
 * `bun run check`. Every fixture is copied to a temporary path first.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";

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
  {
    kind: "link",
    name: "Copy address of relative link",
    payload: (url) => new URL("/local/notes.md", url).href,
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

/** One helper for all four kinds: present, hidden, revealed, named, copying. */
const expectAffordance = async (page: Page, url: string, affordance: Affordance): Promise<void> => {
  const control = page.getByRole("button", { name: affordance.name, exact: true });
  await expect(control, `${affordance.kind} exists before hover`).toHaveCount(1);
  expect(await surfaceOpacity(control), `${affordance.kind} is hidden before hover`).toBe(0);

  const container = page
    .locator(
      `${affordance.kind === "link" ? "[data-mdv-link]" : "[data-block-id]"}:has([aria-label="${affordance.name}"])`,
    )
    .first();
  await container.hover();
  await expect.poll(() => surfaceOpacity(control)).toBe(1);

  await control.click();
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toBe(affordance.payload(url));

  if (affordance.kind === "heading" || affordance.kind === "link") {
    await expect(control).toHaveAttribute("data-mdv-state", "copied");
  } else {
    await expect(control).toHaveText("Copied");
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

test("Tab reaches one control per kind and each is visible while focused", async ({ page }) => {
  const KINDS = ["Copy link to", "Copy address of", "Copy table", "Copy code"] as const;

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

test("the bar and the affordances expose distinct, stable names", async ({ page }) => {
  await withDocument(page, TYPOGRAPHY, async () => {
    const affordanceNames = await page.evaluate(() =>
      [
        ...document.querySelectorAll(
          "[data-mdv-copy-code], [data-mdv-copy-table], [data-mdv-copy-link], [data-mdv-copy-url]",
        ),
      ].map((control) => control.getAttribute("aria-label") ?? ""),
    );

    expect(affordanceNames).toEqual(expect.arrayContaining(["Copy code", "Copy table"]));
    expect(affordanceNames.some((name) => name.startsWith("Copy address of"))).toBe(true);
    expect(affordanceNames.some((name) => name.startsWith("Copy link to"))).toBe(true);

    const all = [...BAR_NAMES, ...affordanceNames];
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
