#!/usr/bin/env bun
/**
 * Write the deterministic large fixtures the bench and the browser bench read.
 *
 * The generator is a seeded LCG, so `bun run fixtures:generate` is
 * byte-identical on every run. `bun run check` never runs it; the committed
 * output is the input.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SEED = 20261025;

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDir = path.join(root, "fixtures", "generated");

const WORDS = [
  "alpha",
  "bravo",
  "charlie",
  "delta",
  "echo",
  "foxtrot",
  "golf",
  "hotel",
  "india",
  "juliet",
  "kilo",
  "lima",
  "mike",
  "november",
  "oscar",
  "papa",
  "quebec",
  "romeo",
  "sierra",
  "tango",
  "uniform",
  "victor",
  "whiskey",
  "xray",
  "yankee",
  "zulu",
];

const LANGUAGES = ["ts", "bash", "json", "yaml", "css"];

const createRandom = (seed: number): (() => number) => {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 2 ** 32;
  };
};

const word = (random: () => number): string => WORDS[Math.floor(random() * WORDS.length)]!;

const sentence = (random: () => number, words: number): string =>
  Array.from({ length: words }, () => word(random)).join(" ");

const codeLine = (random: () => number, language: string): string => {
  switch (language) {
    case "bash":
      return `echo "${word(random)} ${word(random)}"`;
    case "json":
      return `{ "${word(random)}": ${Math.floor(random() * 100)} }`;
    case "yaml":
      return `${word(random)}: ${word(random)}`;
    case "css":
      return `.${word(random)} { color: var(--${word(random)}); }`;
    default:
      return `const ${word(random)} = ${Math.floor(random() * 1000)};`;
  }
};

const generate = (lineCount: number, seed: number, fenceLimit: number): string => {
  const random = createRandom(seed);
  const lines: string[] = [];
  let fences = 0;

  while (lines.length < lineCount) {
    const position = lines.length;
    const remaining = lineCount - lines.length;

    if (position % 100 === 0 && fences < fenceLimit && remaining > 7) {
      const language = LANGUAGES[fences % LANGUAGES.length]!;
      lines.push(`\`\`\`${language}`);
      for (let index = 0; index < 4; index += 1) {
        lines.push(codeLine(random, language));
      }
      lines.push("```", "");
      fences += 1;
      continue;
    }

    if (position % 40 === 0) {
      lines.push(`## Section ${position}`, "");
      continue;
    }

    if (position % 3 === 0) {
      lines.push("");
      continue;
    }

    lines.push(sentence(random, position % 2 === 0 ? 15 : 12));
  }

  return `${lines.slice(0, lineCount).join("\n")}\n`;
};

const fixtures: readonly {
  readonly file: string;
  readonly lines: number;
  readonly fences: number;
}[] = [
  { file: "100kb.md", lines: 2_000, fences: 20 },
  { file: "1mb.md", lines: 20_000, fences: 200 },
];

mkdirSync(outputDir, { recursive: true });

for (const fixture of fixtures) {
  const output = generate(fixture.lines, SEED, fixture.fences);
  writeFileSync(path.join(outputDir, fixture.file), output);
  console.log(`${fixture.file}: ${fixture.lines} lines, ${output.length} bytes`);
}
