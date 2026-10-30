import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = (relative: string): string =>
  fileURLToPath(new URL(`../../../${relative}`, import.meta.url));

const versionRuleOf = (path: string): string => {
  const text = readFileSync(path, "utf8");
  const match = /```version-rule\n([\s\S]*?)```/.exec(text);
  if (match === null) throw new Error(`no version-rule block in ${path}`);
  return (match[1] ?? "").trim();
};

describe("the version rule", () => {
  it("states the version rule identically in both documents", () => {
    const page = versionRuleOf(root("docs/protocol.md"));
    const editor = versionRuleOf(root("docs/editor-protocol.md"));

    expect(page).toBe(editor);
    expect(page).not.toBe("");
  });

  it("names the three additive cases and the four breaking ones", () => {
    const rule = versionRuleOf(root("docs/protocol.md"));

    for (const additive of [
      "a new message member",
      "a new message tag",
      "a new literal value in a closed set",
    ]) {
      expect(rule).toContain(additive);
    }

    for (const breaking of [
      "a renamed field",
      "a retyped field",
      "a removed field",
      "a moved golden byte",
    ]) {
      expect(rule).toContain(breaking);
    }
  });
});
