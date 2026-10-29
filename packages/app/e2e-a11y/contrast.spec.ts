// @effect-diagnostics asyncFunction:off
/**
 * AR-3's browser evidence: every sampled text colour in both themes. The
 * arithmetic comes from `src/contrast.ts`, so the gate and the browser suite
 * cannot disagree about the ratio; this spec only samples.
 */
import { expect, test, type Page } from "@playwright/test";

import { contrastRatio, DECLARED_TEXT_PAIRS, parseColor } from "../src/contrast.ts";
import { PAGE_THEMES } from "../src/client/page-theme.ts";
import { copyFixture, startPreview } from "../e2e/preview-server.ts";

const MINIMUM = 4.5;

const THEMES = ["light", "dark"] as const;

/** The pairs a page theme can change: both sides are page role aliases. */
const PAGE_TEXT_PAIRS = DECLARED_TEXT_PAIRS.filter(
  (pair) => pair.foreground.startsWith("--color-") && pair.background.startsWith("--color-"),
);

type SampledColour = { readonly foreground: string; readonly background: string };

/**
 * Sample a declared pair through a probe element, so the browser resolves
 * `var()` and `color-mix()` to the computed colours the reader ratio uses.
 */
const samplePair = (page: Page, foreground: string, background: string): Promise<SampledColour> =>
  page.evaluate(
    ([foregroundVar, backgroundVar]: readonly [string, string]) => {
      const probe = document.createElement("div");
      probe.style.color = `var(${foregroundVar})`;
      probe.style.backgroundColor = `var(${backgroundVar})`;
      document.body.append(probe);
      const style = getComputedStyle(probe);
      const sample = { foreground: style.color, background: style.backgroundColor };
      probe.remove();
      return sample;
    },
    [foreground, background] as const,
  );

const setMode = async (page: Page, mode: (typeof THEMES)[number]): Promise<void> => {
  const current = await page.evaluate(() =>
    document.documentElement.getAttribute("data-color-mode"),
  );
  if (current !== mode) await page.getByRole("button", { name: /^(Light|Dark)$/u }).click();
  await page.waitForFunction(
    (wanted) => document.documentElement.getAttribute("data-color-mode") === wanted,
    mode,
  );
};

const paintFrame = (page: Page): Promise<void> =>
  page.evaluate(
    () =>
      new Promise<void>((resolvePaint) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolvePaint())),
      ),
  );

const ratioOf = (foreground: string, background: string, label: string): number => {
  expect(parseColor(foreground), `${label} foreground parses: ${foreground}`).not.toBeNull();
  expect(parseColor(background), `${label} background parses: ${background}`).not.toBeNull();
  const ratio = contrastRatio(foreground, background);
  expect(ratio, `${label} ratio exists`).not.toBeNull();
  return ratio ?? 0;
};

/** Run one sampled document through both themes; the fixed dev port allows one at a time. */
const sampleDocument = async (
  page: Page,
  fixture: string,
  sample: (theme: (typeof THEMES)[number]) => Promise<void>,
): Promise<void> => {
  const copy = copyFixture(fixture);
  const server = await startPreview(copy.file);

  try {
    await page.goto(server.url);
    await page.waitForSelector("[data-block-id]");
    await paintFrame(page);
    for (const theme of THEMES) {
      await setMode(page, theme);
      await sample(theme);
    }
  } finally {
    await server.stop();
    copy.stop();
  }
};

test("body, muted, inline-code, and fence text clear 4.5:1 in both themes", async ({ page }) => {
  const measured: { label: string; ratio: number }[] = [];

  await sampleDocument(page, "fixtures/kitchen-sink.md", async (theme) => {
    const body = await page.evaluate(() => {
      const style = getComputedStyle(document.body);
      return { color: style.color, background: style.backgroundColor };
    });
    measured.push({ label: `${theme} body`, ratio: ratioOf(body.color, body.background, "body") });

    const muted = await page.evaluate(() => {
      const quote = document.querySelector("blockquote");
      return {
        color: quote === null ? "" : getComputedStyle(quote).color,
        background: getComputedStyle(document.body).backgroundColor,
      };
    });
    measured.push({
      label: `${theme} muted`,
      ratio: ratioOf(muted.color, muted.background, "muted"),
    });
  });

  await sampleDocument(page, "fixtures/render-fidelity/contrast.md", async (theme) => {
    const inlineCode = await page.evaluate(() => {
      const code = [...document.querySelectorAll("p code")][0];
      return {
        color: code === undefined ? "" : getComputedStyle(code).color,
        background: getComputedStyle(document.body).backgroundColor,
      };
    });
    measured.push({
      label: `${theme} inline code`,
      ratio: ratioOf(inlineCode.color, inlineCode.background, "inline code"),
    });

    // The sheet is linked into the page, so the sampled colour is composed.
    const fence = await page.evaluate(() =>
      [...document.querySelectorAll(".shiki span")].map((token) => getComputedStyle(token).color),
    );
    const codeBackground = await page.evaluate(
      () => getComputedStyle(document.querySelector(".shiki") ?? document.body).backgroundColor,
    );

    expect(fence.length, "at least one fence token").toBeGreaterThan(0);
    expect(
      fence.some((value) => value.trim() !== ""),
      "at least one computed token colour",
    ).toBe(true);
    for (const [index, value] of fence.entries()) {
      if (value.trim() === "") continue;
      measured.push({
        label: `${theme} fence token ${index}`,
        ratio: ratioOf(value.trim(), codeBackground, "fence token"),
      });
    }
  });

  const smallest = [...measured].toSorted((a, b) => a.ratio - b.ratio)[0];
  for (const sample of measured) console.log(`${sample.label}: ${sample.ratio.toFixed(2)}`);
  console.log(`smallest: ${smallest?.label} ${smallest?.ratio.toFixed(2)}`);
  for (const sample of measured) {
    expect(sample.ratio, sample.label).toBeGreaterThanOrEqual(MINIMUM);
  }
});

test("every declared text pair clears 4.5:1 in both themes", async ({ page }) => {
  await sampleDocument(page, "fixtures/kitchen-sink.md", async (theme) => {
    for (const pair of DECLARED_TEXT_PAIRS) {
      const sample = await samplePair(page, pair.foreground, pair.background);
      const ratio = ratioOf(sample.foreground, sample.background, `${theme} ${pair.foreground}`);
      console.log(`${theme} ${pair.foreground} on ${pair.background}: ${ratio.toFixed(2)}`);
      expect(ratio, `${theme} ${pair.foreground} on ${pair.background}`).toBeGreaterThanOrEqual(
        MINIMUM,
      );
    }
  });
});

test("every shipped page theme clears 4.5:1 in the scheme it declares", async ({ page }) => {
  const copy = copyFixture("fixtures/kitchen-sink.md");
  const server = await startPreview(copy.file);

  try {
    await page.goto(server.url);
    await page.waitForSelector("[data-block-id]");

    for (const theme of PAGE_THEMES) {
      await page.evaluate(
        (name) => document.documentElement.setAttribute("data-theme", name),
        theme.name,
      );
      await paintFrame(page);

      let smallest = { label: "", ratio: Number.POSITIVE_INFINITY };
      for (const pair of PAGE_TEXT_PAIRS) {
        const sample = await samplePair(page, pair.foreground, pair.background);
        const ratio = ratioOf(
          sample.foreground,
          sample.background,
          `${theme.name} ${pair.foreground}`,
        );
        if (ratio < smallest.ratio) smallest = { label: pair.foreground, ratio };
        expect(
          ratio,
          `${theme.name} (${theme.scheme}) ${pair.foreground} on ${pair.background}: ${sample.foreground} on ${sample.background}`,
        ).toBeGreaterThanOrEqual(MINIMUM);
      }
      console.log(
        `${theme.name}: smallest ${smallest.label} ${smallest.ratio.toFixed(2)} over ${PAGE_TEXT_PAIRS.length} pairs`,
      );
    }
  } finally {
    await server.stop();
    copy.stop();
  }
});

test("the KaTeX error text clears 4.5:1 in both themes", async ({ page }) => {
  await sampleDocument(page, "fixtures/render-fidelity/math.md", async (theme) => {
    const sample = await page.evaluate(() => {
      const spans = [...document.querySelectorAll(".katex")];
      const error = spans.find((span) => (span.textContent ?? "").includes("\\notacommand"));
      return {
        color: error === undefined ? "" : getComputedStyle(error).color,
        background: getComputedStyle(document.body).backgroundColor,
      };
    });
    const ratio = ratioOf(sample.color, sample.background, `${theme} katex error`);
    console.log(`${theme} katex error: ${ratio.toFixed(2)}`);
    expect(ratio, `${theme} katex error`).toBeGreaterThanOrEqual(MINIMUM);
  });
});

test("samples the composed role colours for one non-default pair", async ({ page }) => {
  const copy = copyFixture("fixtures/render-fidelity/themes.md");
  const server = await startPreview(copy.file);

  try {
    await page.goto(server.url);
    await page.waitForSelector(".shiki");
    await page.getByRole("button", { name: "Line numbers" }).click();
    await page.selectOption('[data-theme-select="light"]', "light-plus");
    await page.selectOption('[data-theme-select="dark"]', "dark-plus");

    for (const theme of THEMES) {
      await setMode(page, theme);
      await paintFrame(page);
      const sample = await page.evaluate(() => ({
        background: getComputedStyle(document.querySelector(".shiki") ?? document.body)
          .backgroundColor,
        colours: [...document.querySelectorAll(".shiki span")].map(
          (token) => getComputedStyle(token).color,
        ),
        gutter: getComputedStyle(document.querySelector(".line") ?? document.body, "::before")
          .color,
      }));

      const ratios = sample.colours.map((colour, index) =>
        ratioOf(colour, sample.background, `${theme} role ${index}`),
      );
      ratios.push(ratioOf(sample.gutter, sample.background, `${theme} gutter`));
      console.log(
        `${theme} non-default smallest: ${Math.min(...ratios).toFixed(2)} (${ratios.length} samples)`,
      );
      for (const ratio of ratios) expect(ratio).toBeGreaterThanOrEqual(MINIMUM);
    }
  } finally {
    await server.stop();
    copy.stop();
  }
});
