// @effect-diagnostics asyncFunction:off
/**
 * AR-3's browser evidence: every sampled text colour in both themes. The
 * arithmetic comes from `src/contrast.ts`, so the gate and the browser suite
 * cannot disagree about the ratio; this spec only samples.
 */
import { expect, test, type Page } from "@playwright/test";

import { contrastRatio, DECLARED_TEXT_PAIRS, parseColor } from "../src/contrast.ts";
import { copyFixture, startPreview } from "../e2e/preview-server.ts";

const MINIMUM = 4.5;

const THEMES = ["light", "dark"] as const;

const setTheme = async (page: Page, theme: (typeof THEMES)[number]): Promise<void> => {
  const current = await page.evaluate(() => document.documentElement.getAttribute("data-theme"));
  if (current !== theme) await page.getByRole("button", { name: /^(Light|Dark)$/u }).click();
  await page.waitForFunction(
    (wanted) => document.documentElement.getAttribute("data-theme") === wanted,
    theme,
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
      await setTheme(page, theme);
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

    // Inline `--shiki-*` values are what `styles.css` reads; a stylesheet scan
    // could not satisfy this spec.
    const fence = await page.evaluate((dark) => {
      const tokens = [...document.querySelectorAll(".shiki span")];
      return tokens.map((token) =>
        dark
          ? getComputedStyle(token).getPropertyValue("--shiki-dark")
          : getComputedStyle(token).getPropertyValue("--shiki-light"),
      );
    }, theme === "dark");
    const codeBackground = await page.evaluate(
      () => getComputedStyle(document.querySelector(".shiki") ?? document.body).backgroundColor,
    );

    expect(fence.length, "at least one fence token").toBeGreaterThan(0);
    expect(
      fence.some((value) => value.trim() !== ""),
      "at least one inline --shiki value",
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
    const values = await page.evaluate((pairs) => {
      const style = getComputedStyle(document.documentElement);
      return pairs.map((pair) => ({
        foreground: style.getPropertyValue(pair.foreground).trim(),
        background: style.getPropertyValue(pair.background).trim(),
      }));
    }, DECLARED_TEXT_PAIRS);

    for (const [index, pair] of DECLARED_TEXT_PAIRS.entries()) {
      const sample = values[index];
      if (sample === undefined) continue;
      const ratio = ratioOf(sample.foreground, sample.background, `${theme} ${pair.foreground}`);
      console.log(`${theme} ${pair.foreground} on ${pair.background}: ${ratio.toFixed(2)}`);
      expect(ratio, `${theme} ${pair.foreground} on ${pair.background}`).toBeGreaterThanOrEqual(
        MINIMUM,
      );
    }
  });
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
