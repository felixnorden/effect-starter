#!/usr/bin/env bun
/**
 * A row whose pointer does not resolve is a claim with no evidence. Read the
 * §1.1 tables in `docs/requirements.md`, collect every backticked path, and
 * resolve each against the repository root and the source-convention roots the
 * document already uses.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const requirementsPath = path.join(root, "docs/requirements.md");

const candidates = [
  ".",
  "packages",
  "packages/core/src",
  "packages/core/src/render",
  "packages/core/src/render/__snapshots__",
  "packages/core",
  "packages/app/src",
  "packages/app/src/client",
  "packages/app",
];

const extensions = [
  ".ts",
  ".tsx",
  ".md",
  ".json",
  ".yml",
  ".yaml",
  ".lua",
  ".vim",
  ".sh",
  ".mjs",
  ".html",
  ".css",
];

const looksLikePath = (value: string): boolean => {
  if (value === "" || /\s/.test(value)) return false;
  if (value.startsWith("http")) return false;
  if (value.includes("*") || value.includes("<") || value.includes(">") || value.includes("..."))
    return false;
  return value.includes("/") || extensions.some((extension) => value.endsWith(extension));
};

const resolves = (value: string): boolean =>
  candidates.some((base) => existsSync(path.resolve(root, base, value)));

const pointersOf = (section: string): ReadonlySet<string> => {
  const pointers = new Set<string>();
  for (const line of section.split("\n")) {
    if (!line.trimStart().startsWith("|")) continue;
    for (const match of line.matchAll(/`([^`]+)`/g)) {
      const value = (match[1] ?? "").trim();
      if (looksLikePath(value)) pointers.add(value);
    }
  }
  return pointers;
};

const editorScriptsOf = (section: string): ReadonlySet<string> => {
  const names = new Set<string>();
  for (const line of section.split("\n")) {
    if (!line.trimStart().startsWith("|")) continue;
    for (const cell of line.matchAll(/`([^`]+)`/g)) {
      for (const match of (cell[1] ?? "").matchAll(/editor:[A-Za-z0-9:_-]+/g)) {
        names.add(match[0]);
      }
    }
  }
  return names;
};

const missingEditorScripts = (
  names: ReadonlySet<string>,
  scripts: Readonly<Record<string, string>>,
): readonly string[] => [...names].filter((name) => !(name in scripts));

const text = readFileSync(requirementsPath, "utf8");
const start = text.indexOf("## 1.1 Implementation status");
const end = text.indexOf("## 2. Baseline analysis");
const section = start >= 0 && end > start ? text.slice(start, end) : "";
const pointers = pointersOf(section);
const editorScripts = editorScriptsOf(section);
const rootPackage = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as {
  readonly scripts?: Readonly<Record<string, string>>;
};
const scripts = rootPackage.scripts ?? {};

const missing = [...pointers].filter((value) => !resolves(value));
const missingScripts = missingEditorScripts(editorScripts, scripts);

if (missing.length > 0) {
  for (const value of missing) {
    console.error(`FAIL ${value}: no match under ${candidates.join(", ")}`);
  }
  console.error(`FAIL ${missing.length} of ${pointers.size} requirement pointers do not resolve`);
}

for (const value of missingScripts) {
  console.error(`FAIL ${value}: no script`);
}

const doctored = new Set(["editor:no_such_script_for_this_check"]);
if (missingEditorScripts(doctored, scripts).length !== 1) {
  console.error("FAIL editor self-case: a bogus editor:<name> citation passed the check");
  process.exit(1);
}

if (missing.length > 0 || missingScripts.length > 0) process.exit(1);

console.log(
  `OK requirements pointers (${pointers.size} paths resolve, ${editorScripts.size} editor scripts resolve)`,
);
