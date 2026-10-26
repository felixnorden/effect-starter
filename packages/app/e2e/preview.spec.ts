// @effect-diagnostics asyncFunction:off
/**
 * The browser bench, outside `bun run check`.
 *
 *   bunx playwright install chromium
 *   bun run bench:browser                  # compare against the stored baseline
 *   BASELINE=write bun run bench:browser   # record a new baseline on this machine
 *
 * PF-3's 2 s including browser launch is not measured here: Playwright uses a
 * warm browser. PF-4 is measured from the last `preview:patch` mark to the
 * next paint; write-to-paint is reported separately.
 */
import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { cpus, platform, release } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { copyFixture, startPreview } from "./preview-server.ts";

const here = fileURLToPath(new URL(".", import.meta.url));
const baselinePath = resolve(here, "../bench/browser-baseline.json");

const ITERATIONS = 20;

const BUDGETS = {
  pf3: 700,
  pf4: 100,
  pf5Paint: 2_500,
  pf5Update: 250,
} as const;

type Metrics = Record<keyof typeof BUDGETS, number>;

type Baseline = {
  readonly date: string;
  readonly machine: { readonly platform: string; readonly release: string; readonly cpu: string };
  readonly budgets: typeof BUDGETS;
  readonly p95: Metrics;
};

const machine = () => ({
  platform: platform(),
  release: release(),
  cpu: cpus()[0]?.model ?? "unknown",
});

const p95 = (values: readonly number[]): number => {
  const sorted = [...values].toSorted((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)] ?? 0;
};

const readBaseline = (): Baseline | null => {
  try {
    return JSON.parse(readFileSync(baselinePath, "utf8")) as Baseline;
  } catch {
    return null;
  }
};

const firstPaint = async (page: Page, url: string): Promise<number> => {
  const started = Date.now();
  await page.goto(url);
  await page.waitForSelector("[data-block-id]");
  return Date.now() - started;
};

const editParagraph = (file: string, run: number): void => {
  const source = readFileSync(file, "utf8");
  const lines = source.split("\n");
  const index = lines.findIndex(
    (line) =>
      line.trim() !== "" &&
      !line.startsWith("#") &&
      !line.startsWith("```") &&
      !line.startsWith("|") &&
      !line.startsWith("-") &&
      !line.startsWith(">"),
  );
  lines[index] = `${lines[index] ?? ""} bench-${run}`;
  writeFileSync(file, lines.join("\n"));
};

const waitForPatch = async (page: Page, run: number): Promise<number> => {
  await page.waitForFunction((value) => document.body.textContent?.includes(`bench-${value}`), run);
  return page.evaluate(async () => {
    const mark = performance
      .getEntriesByType("mark")
      .filter((entry) => entry.name === "preview:patch")
      .at(-1);
    await new Promise<void>((resolvePaint) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolvePaint())),
    );
    return performance.now() - (mark?.startTime ?? performance.now());
  });
};

test.describe.configure({ mode: "serial" });

test("browser bench", async ({ page }) => {
  const fixtures = {
    small: "fixtures/generated/100kb.md",
    large: "fixtures/generated/1mb.md",
  } as const;

  const measured: Metrics = { pf3: 0, pf4: 0, pf5Paint: 0, pf5Update: 0 };
  const writeToPaint: number[] = [];

  const smallCopy = copyFixture(fixtures.small);
  try {
    const server = await startPreview(smallCopy.file);
    try {
      // PF-3: 100 KB page paint over 20 reloads.
      const pf3: number[] = [];
      for (let run = 0; run < ITERATIONS; run += 1) {
        pf3.push(await firstPaint(page, server.url));
      }
      measured.pf3 = p95(pf3);

      // PF-4: one-paragraph edit to the next paint, from the last mark.
      const pf4: number[] = [];
      for (let run = 0; run < ITERATIONS; run += 1) {
        const written = Date.now();
        editParagraph(smallCopy.file, run);
        pf4.push(await waitForPatch(page, run));
        writeToPaint.push(Date.now() - written);
      }
      measured.pf4 = p95(pf4);
    } finally {
      await server.stop();
    }
  } finally {
    smallCopy.stop();
  }

  const largeCopy = copyFixture(fixtures.large);
  try {
    const server = await startPreview(largeCopy.file);
    try {
      // PF-5: 1 MB paint and update.
      const pf5Paint: number[] = [];
      for (let run = 0; run < ITERATIONS; run += 1) {
        pf5Paint.push(await firstPaint(page, server.url));
      }
      measured.pf5Paint = p95(pf5Paint);

      const pf5Update: number[] = [];
      for (let run = 0; run < ITERATIONS; run += 1) {
        editParagraph(largeCopy.file, run);
        pf5Update.push(await waitForPatch(page, run));
      }
      measured.pf5Update = p95(pf5Update);
    } finally {
      await server.stop();
    }
  } finally {
    largeCopy.stop();
  }

  const baseline = readBaseline();
  const report = {
    machine: machine(),
    date: new Date().toISOString(),
    budgets: BUDGETS,
    p95: measured,
    writeToPaint: { p95: p95(writeToPaint) },
  };
  console.log(JSON.stringify(report, null, 2));

  if (process.env.BASELINE === "write") {
    mkdirSync(dirname(baselinePath), { recursive: true });
    writeFileSync(
      baselinePath,
      `${JSON.stringify({ machine: report.machine, date: report.date, budgets: BUDGETS, p95: measured }, null, 2)}\n`,
    );
    return;
  }

  expect(baseline, "run BASELINE=write bun run bench:browser first").not.toBeNull();
  if (baseline === null) return;

  expect(measured.pf3).toBeLessThanOrEqual(BUDGETS.pf3);
  expect(measured.pf4).toBeLessThanOrEqual(BUDGETS.pf4);
  expect(measured.pf5Paint).toBeLessThanOrEqual(BUDGETS.pf5Paint);
  expect(measured.pf5Update).toBeLessThanOrEqual(BUDGETS.pf5Update);

  expect(measured.pf3).toBeLessThanOrEqual(baseline.p95.pf3 * 1.2);
  expect(measured.pf4).toBeLessThanOrEqual(baseline.p95.pf4 * 1.2);
  expect(measured.pf5Paint).toBeLessThanOrEqual(baseline.p95.pf5Paint * 1.2);
  expect(measured.pf5Update).toBeLessThanOrEqual(baseline.p95.pf5Update * 1.2);
});
