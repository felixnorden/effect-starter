import { existsSync, readFileSync, readdirSync } from "node:fs";
import { EDITOR_PROTOCOL_VERSION } from "@mdv/core/editor-protocol";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../", import.meta.url));

const files = (dir: string): readonly string[] =>
  existsSync(dir)
    ? readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        return entry.isDirectory() ? files(full) : [full];
      })
    : [];

const nvimFiles = (): readonly string[] => files(path.join(root, "nvim"));
const vimFiles = (): readonly string[] => files(path.join(root, "vim"));

const read = (relative: string): string => readFileSync(path.join(root, relative), "utf8");

const handWritten = (files: readonly string[]): readonly string[] =>
  files.filter((file) => !file.includes(`${path.sep}generated${path.sep}`));

const describeFiles = (list: readonly string[]): string =>
  list.map((file) => path.relative(root, file)).join(", ");

/** The plugin and autoload trees only; tests may read JSON to load the cases. */
const vimModules = (): readonly string[] =>
  handWritten(vimFiles()).filter(
    (file) => file.endsWith(".vim") && (file.includes(`plugin`) || file.includes(`autoload`)),
  );

const quoted = (text: string): readonly string[] =>
  [...text.matchAll(/["']([^"']+)["']/g)].map((match) => match[1] ?? "");

const tagsUnder = (text: string, marker: RegExp): readonly string[] => {
  const match = text.match(marker);
  return match === null ? [] : quoted(match[0]).filter((value) => value !== "tags");
};

const versionUnder = (text: string, marker: RegExp): number | null => {
  const match = text.match(marker);
  return match === null ? null : Number(match[1]);
};

describe("editor assets", () => {
  it("has every Neovim module and calls the generated codec", () => {
    const required = [
      "nvim/plugin/markdown_viewer.lua",
      "nvim/lua/markdown_viewer/session.lua",
      "nvim/lua/markdown_viewer/frames.lua",
      "nvim/lua/markdown_viewer/discovery.lua",
      "nvim/lua/markdown_viewer/messages.lua",
      "nvim/lua/markdown_viewer/generated/wire.lua",
      "nvim/lua/markdown_viewer/generated/codec.lua",
    ];

    for (const file of required) {
      expect(existsSync(path.join(root, file)), file).toBe(true);
    }

    const session = read("nvim/lua/markdown_viewer/session.lua");
    const frames = read("nvim/lua/markdown_viewer/frames.lua");

    expect(session).toContain('require("markdown_viewer.generated.codec")');
    for (const text of [session, frames]) {
      expect(text).not.toContain("vim.json");
      expect(text).not.toContain("vim.mpack");
      expect(text).not.toContain("0x0A");
    }
  });

  it("defines the three commands, six maps, and no version literal", () => {
    const plugin = read("nvim/plugin/markdown_viewer.lua");
    const commands = ["MarkdownPreview", "MarkdownPreviewStop", "MarkdownPreviewToggle"];

    for (const command of commands) {
      expect(plugin).toContain(`nvim_create_user_command("${command}"`);
      const plug = `"<Plug>(${command})"`;
      expect(plugin.split(plug).length - 1, command).toBe(2);
    }

    const handWrittenFiles = handWritten(nvimFiles()).filter((file) => file.endsWith(".lua"));
    for (const file of handWrittenFiles) {
      const text = readFileSync(file, "utf8");
      expect(/editorProtocolVersion\s*=\s*\d/.test(text), describeFiles([file])).toBe(false);
    }
  });

  it("has every Vim module and calls the generated codec", () => {
    const required = [
      "vim/plugin/markdown_viewer.vim",
      "vim/autoload/markdown_viewer/session.vim",
      "vim/autoload/markdown_viewer/frames.vim",
      "vim/autoload/markdown_viewer/discovery.vim",
      "vim/autoload/markdown_viewer/messages.vim",
      "vim/autoload/markdown_viewer/generated/wire.vim",
      "vim/autoload/markdown_viewer/generated/codec.vim",
    ];

    for (const file of required) {
      expect(existsSync(path.join(root, file)), file).toBe(true);
    }

    const frames = read("vim/autoload/markdown_viewer/frames.vim");
    expect(frames).toContain("markdown_viewer#generated#codec#");

    const handWrittenFiles = vimModules();
    for (const file of handWrittenFiles) {
      const text = readFileSync(file, "utf8");
      expect(text, describeFiles([file])).not.toContain("json_encode");
      expect(text, describeFiles([file])).not.toContain("json_decode");
      expect(text, describeFiles([file])).not.toContain("msgpack");
    }
  });

  it("keeps both adapters on the same generated names", () => {
    const lua = read("nvim/lua/markdown_viewer/generated/wire.lua");
    const vim = read("vim/autoload/markdown_viewer/generated/wire.vim");

    const luaTags = tagsUnder(lua, /M\.tags = \{[^}]*\}/);
    const vimTags = tagsUnder(vim, /'tags': \[[^\]]*\]/);

    expect(new Set(luaTags)).toEqual(new Set(["document", "ready", "error"]));
    expect(new Set(vimTags)).toEqual(new Set(luaTags));
    expect(versionUnder(lua, /M\.editor_protocol_version = (\d+)/)).toBe(EDITOR_PROTOCOL_VERSION);
    expect(versionUnder(vim, /'editor_protocol_version': (\d+)/)).toBe(EDITOR_PROTOCOL_VERSION);
  });

  it("defines the same three commands and six maps in Vim, with no version literal", () => {
    const plugin = read("vim/plugin/markdown_viewer.vim");
    const commands = ["MarkdownPreview", "MarkdownPreviewStop", "MarkdownPreviewToggle"];

    for (const command of commands) {
      expect(plugin).toContain(`command! ${command} `);
      const plug = `<Plug>(${command})`;
      expect(plugin.split(plug).length - 1, command).toBe(2);
    }

    const handWrittenFiles = vimModules();
    for (const file of handWrittenFiles) {
      const text = readFileSync(file, "utf8");
      expect(/editorProtocolVersion\s*=\s*\d/.test(text), describeFiles([file])).toBe(false);
    }
  });
});
