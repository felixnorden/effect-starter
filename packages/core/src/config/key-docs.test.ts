import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { configKeys, type ConfigKey } from "./declaration.ts";

const requirementsPath = fileURLToPath(
  new URL("../../../../docs/requirements.md", import.meta.url),
);

type KeyRow = {
  readonly key: string;
  readonly default: unknown;
  readonly container: boolean;
  readonly vimName: string;
};

const sectionOf = (text: string, heading: string, next: string): string => {
  const start = text.indexOf(heading);
  const end = text.indexOf(next);
  if (start < 0 || end <= start) throw new Error(`missing section ${heading}`);
  return text.slice(start, end);
};

const tableRows = (section: string): readonly (readonly string[])[] => {
  const lines = section
    .split("\n")
    .filter((line) => line.trimStart().startsWith("|"))
    .slice(2);
  return lines.map((line) =>
    line
      .trim()
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((cell) => cell.trim()),
  );
};

/** A §5 cell is readable only when it is one code span. */
const codeOf = (cell: string): string => {
  const match = /^`(.*)`$/.exec(cell);
  if (match === null) throw new Error(`unreadable documentation cell: ${cell}`);
  return match[1] ?? "";
};

const unquote = (value: string): string => {
  const match = /^"(.*)"$/s.exec(value);
  return match === null ? value : (match[1] ?? "");
};

const parseDefaultCell = (cell: string): unknown => {
  const inner = codeOf(cell);
  if (inner === "nil" || inner === "null") return null;
  if (inner === "true") return true;
  if (inner === "false") return false;
  if (inner === "{}") return {};
  if (inner === "[]") return [];
  if (/^-?\d+(\.\d+)?$/.test(inner)) return Number(inner);
  if (inner.startsWith("{")) {
    const body = inner.slice(1, -1).trim();
    if (body === "") return [];
    return body
      .split(",")
      .map((value) => unquote(value.trim()))
      .filter((value) => value !== "");
  }
  if (inner.startsWith('"')) return JSON.parse(inner) as unknown;
  return inner;
};

const parseKeyRows = (text: string): readonly KeyRow[] => {
  const topLevel = tableRows(sectionOf(text, "### 5.1 Top-level options", "### 5.2"));
  const preview = tableRows(sectionOf(text, "### 5.2 `g:mkdp_preview_options` keys", "### 5.3"));
  const added = tableRows(sectionOf(text, "### 5.3 New settings", "### 5.4"));
  const vim = tableRows(sectionOf(text, "### 5.4 Vim variable names", "## 6."));

  const documented = [
    ...topLevel.map((cells) => ({
      key: codeOf(cells[1] ?? ""),
      default: parseDefaultCell(cells[2] ?? ""),
    })),
    ...preview.map((cells) => ({
      key: codeOf(cells[1] ?? ""),
      default: parseDefaultCell(cells[2] ?? ""),
    })),
    ...added.map((cells) => ({
      key: codeOf(cells[0] ?? ""),
      default: parseDefaultCell(cells[1] ?? ""),
    })),
  ];
  const vimNames = new Map(
    vim.map((cells) => [codeOf(cells[0] ?? ""), codeOf(cells[1] ?? "")] as const),
  );

  return documented.map((row) => {
    const vimName = vimNames.get(row.key);
    if (vimName === undefined) throw new Error(`no Vim name documented for ${row.key}`);
    return {
      key: row.key,
      default: row.default,
      container: row.key === "preview.options",
      vimName,
    };
  });
};

const sameValue = (left: unknown, right: unknown): boolean =>
  JSON.stringify(left) === JSON.stringify(right);

const compareKeyTables = (rows: readonly KeyRow[], declared: readonly ConfigKey[]): string[] => {
  const failures: string[] = [];
  const byName = new Map(declared.map((entry) => [entry.name, entry]));
  const seen = new Set<string>();

  for (const row of rows) {
    seen.add(row.key);
    const entry = byName.get(row.key);

    if (entry === undefined) {
      failures.push(`documented and not declared: ${row.key}`);
      continue;
    }

    if (entry.container) {
      if (!sameValue(row.default, {})) {
        failures.push(
          `container ${row.key} is documented with a value ${JSON.stringify(row.default)}`,
        );
      }
    } else if (!sameValue(row.default, entry.default)) {
      failures.push(
        `default for ${row.key}: declared ${JSON.stringify(entry.default)}, documented ${JSON.stringify(row.default)}`,
      );
    }

    if (row.vimName !== entry.vimName) {
      failures.push(
        `Vim name for ${row.key}: declared ${entry.vimName}, documented ${row.vimName}`,
      );
    }
  }

  for (const entry of declared) {
    if (!seen.has(entry.name)) failures.push(`declared and not documented: ${entry.name}`);
  }

  return failures;
};

const realRows = (): readonly KeyRow[] => parseKeyRows(readFileSync(requirementsPath, "utf8"));

const replaced = (
  rows: readonly KeyRow[],
  key: string,
  patch: Partial<KeyRow>,
): readonly KeyRow[] => rows.map((row) => (row.key === key ? { ...row, ...patch } : row));

describe("§5 configuration documentation", () => {
  it("compares documented keys, defaults and Vim names with the declaration", () => {
    const rows = realRows();
    const declared = configKeys();

    expect(compareKeyTables(rows, declared)).toEqual([]);
    expect(rows).toHaveLength(declared.length);
    expect(rows.filter((row) => row.key === "preview.options")).toHaveLength(1);
    expect(rows.filter((row) => row.default !== null)).not.toHaveLength(0);
  });

  it("documents the twelve nested preview option children", () => {
    const text = readFileSync(requirementsPath, "utf8");
    const rows = tableRows(sectionOf(text, "### 5.2 `g:mkdp_preview_options` keys", "### 5.3"));

    expect(rows.map((cells) => codeOf(cells[1] ?? ""))).toEqual([
      "render.markdown_it",
      "render.katex",
      "render.plantuml",
      "render.mermaid",
      "render.toc",
      "render.hide_front_matter",
      "scroll.enabled",
      "scroll.mode",
      "render.sequence_diagrams",
      "render.flowchart",
      "preview.content_editable",
      "preview.show_filename",
    ]);
  });

  it("fails on a Vim name that disagrees, naming the key and both names", () => {
    const declared = configKeys();
    const doctored = replaced(realRows(), "preview.width", {
      vimName: "g:markdown_viewer_width",
    });

    const failures = compareKeyTables(doctored, declared);

    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("preview.width");
    expect(failures[0]).toContain("g:markdown_viewer_preview_width");
    expect(failures[0]).toContain("g:markdown_viewer_width");
  });

  it("fails on a default that disagrees, naming the key and both values", () => {
    const declared = configKeys();
    const doctored = replaced(realRows(), "preview.width", { default: "800px" });

    const failures = compareKeyTables(doctored, declared);

    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("preview.width");
    expect(failures[0]).toContain("900px");
    expect(failures[0]).toContain("800px");
  });

  it("fails on a key documented and not declared", () => {
    const declared = configKeys();
    const doctored = [
      ...realRows(),
      {
        key: "preview.invented",
        default: "x",
        container: false,
        vimName: "g:markdown_viewer_preview_invented",
      },
    ];

    const failures = compareKeyTables(doctored, declared);

    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("preview.invented");
  });

  it("throws on a default cell the parser cannot read", () => {
    const text = readFileSync(requirementsPath, "utf8");
    const doctored = text.replace(
      /(\| `preview\.width`\s*\| )`"900px"`/,
      (_match, prefix: string) => `${prefix}900px`,
    );

    expect(doctored).not.toBe(text);
    expect(() => parseKeyRows(doctored)).toThrow(/unreadable documentation cell/);
  });
});
