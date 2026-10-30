import { describe, expect, it } from "vitest";

import { CONFIG_ERROR_FORMAT, configKeys } from "@mdv/core/config";

import { renderConfig } from "./render-config.ts";

const namesIn = (source: string, pattern: RegExp): readonly string[] =>
  [...source.matchAll(pattern)].map((match) => match[1] ?? "");

const rendered = renderConfig();

describe("rendered configuration tables", () => {
  it("renders the same key set, defaults, aliases, Vim names and classes for both languages", () => {
    expect(rendered.rows.map((row) => row.name)).toEqual(configKeys().map((entry) => entry.name));

    const luaNames = namesIn(rendered.nvim.source, /[,{] name = "([^"]+)"/g);
    const vimNames = namesIn(rendered.vim.source, /'name': '([^']+)'/g);

    expect(luaNames).toEqual(rendered.rows.map((row) => row.name));
    expect(vimNames).toEqual(luaNames);

    for (const row of rendered.rows) {
      expect(rendered.nvim.source).toContain(`vim_name = "${row.vimName}"`);
      expect(rendered.vim.source).toContain(`'vim_name': '${row.vimName}'`);
      expect(rendered.nvim.source).toContain(`default_kind = "${row.defaultKind}"`);
      expect(rendered.vim.source).toContain(`'default_kind': '${row.defaultKind}'`);
      expect(rendered.nvim.source).toContain(
        row.alias === null ? "alias = nil" : `alias = "${row.alias}"`,
      );
      expect(rendered.vim.source).toContain(
        row.alias === null ? "'alias': v:null" : `'alias': '${row.alias}'`,
      );
      expect(rendered.nvim.source).toContain(
        row.class === null ? "class = nil" : `class = "${row.class}"`,
      );
      expect(rendered.vim.source).toContain(
        row.class === null ? "'class': v:null" : `'class': '${row.class}'`,
      );
    }
  });

  it("carries one identical error format string", () => {
    expect(rendered.errorFormat).toBe(CONFIG_ERROR_FORMAT);
    expect(rendered.nvim.source).toContain(
      `M.error_format = ${JSON.stringify(CONFIG_ERROR_FORMAT)}`,
    );
    expect(rendered.vim.source).toContain(`'error_format': '${CONFIG_ERROR_FORMAT}'`);
  });

  it("renders deterministically from two calls", () => {
    const again = renderConfig();

    expect(again.nvim.source).toBe(rendered.nvim.source);
    expect(again.vim.source).toBe(rendered.vim.source);
    expect(again.rows).toEqual(rendered.rows);
  });

  it("names the generated files", () => {
    expect(rendered.nvim.file).toBe("nvim/lua/markdown_viewer/generated/config.lua");
    expect(rendered.vim.file).toBe("vim/autoload/markdown_viewer/generated/config.vim");
  });
});
