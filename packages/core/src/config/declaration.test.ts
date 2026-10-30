import { describe, expect, it } from "vitest";

import {
  CONFIG_ERROR_FORMAT,
  configAliasOf,
  configClassOf,
  configDefaults,
  configKeys,
  configVimNameOf,
  configurationErrorMessage,
  validateConfigValue,
} from "./declaration.ts";

const byName = new Map(configKeys().map((key) => [key.name, key]));

const key = (name: string) => {
  const value = byName.get(name);
  if (value === undefined) throw new Error(`no declared key ${name}`);
  return value;
};

describe("configuration declaration", () => {
  it("declares each key once, with a default, a class, a Vim name and its alias", () => {
    const keys = configKeys();
    const names = keys.map((entry) => entry.name);

    expect(new Set(names).size).toBe(names.length);
    expect(names).toEqual([...names].sort());

    for (const entry of keys) {
      expect(typeof entry.vimName, entry.name).toBe("string");
      expect(entry.vimName.startsWith("g:markdown_viewer_"), entry.name).toBe(true);
      if (entry.container) {
        expect(entry.class, entry.name).toBeNull();
        expect("default" in entry, entry.name).toBe(false);
      } else {
        expect(entry.class === null, entry.name).toBe(false);
        expect(entry.name in configDefaults, entry.name).toBe(true);
      }
    }
  });

  it("declares the §5 keys by their documented names", () => {
    const names = new Set(configKeys().map((entry) => entry.name));

    expect(key("preview.options").container).toBe(true);
    expect(key("preview.content_editable").name).toBe("preview.content_editable");
    expect(key("scroll.mode").name).toBe("scroll.mode");
    expect(key("scroll.smooth").name).toBe("scroll.smooth");
    expect(names.has("preview.options.sync_scroll_type")).toBe(false);
    expect(names.has("server.path")).toBe(false);
  });

  it("treats a non-literal default as a declared sentinel", () => {
    expect(key("theme.code_light").default).toBeNull();
    expect(key("theme.code_dark").default).toBeNull();
    expect(key("render.markdown_it").default).toEqual({});
    expect(key("preview.options").container).toBe(true);
    expect(key("browser.open_function").default).toBeNull();
    expect(key("preview.filetypes").default).toEqual(["markdown"]);
  });

  it("classifies a key by where its value goes", () => {
    expect(configClassOf("render.markdown_it")).toBe("render");
    expect(configClassOf("preview.filetypes")).toBe("editor");
    expect(configClassOf("server.port")).toBe("endpoint");
    expect(configClassOf("preview.width")).toBe("page-display");
    expect(configClassOf("export.format")).toBe("process");
    expect(configClassOf("theme.print")).toBe("process");
    expect(configClassOf("scroll.enabled")).toBe("editor");
    expect(configClassOf("assets.allow_remote")).toBe("render");
    expect(configClassOf("preview.options")).toBeNull();
  });

  it("a container row has no class and no value", () => {
    const container = key("preview.options");
    const children = configKeys()
      .filter((entry) => !entry.container && entry.name.split(".")[0] !== "export")
      .map((entry) => entry.name);

    expect(container.container).toBe(true);
    expect(container.class).toBeNull();
    expect("default" in container).toBe(false);
    expect(
      configKeys()
        .filter((entry) => entry.name.startsWith("render."))
        .map((entry) => entry.name),
    ).toEqual([
      "render.flowchart",
      "render.hide_front_matter",
      "render.katex",
      "render.markdown_it",
      "render.mermaid",
      "render.plantuml",
      "render.sequence_diagrams",
      "render.toc",
    ]);
    expect(children.length).toBeGreaterThan(0);
  });

  it("carries each key's baseline alias, scope and enumeration", () => {
    expect(configAliasOf("scroll.mode")).toBe("sync_scroll_type");
    expect(key("scroll.mode").values).toEqual(["middle", "top", "relative"]);
    expect(key("scroll.mode").aliasScope).toBe("preview_options");
    expect(key("scroll.smooth").default).toBe(true);
    expect(key("preview.font_size").default).toBe("16px");
    expect(configAliasOf("preview.auto_start")).toBe("auto_start");
    expect(key("preview.auto_start").aliasScope).toBe("global");
    expect(configAliasOf("preview.width")).toBeNull();
    expect(configVimNameOf("preview.width")).toBe("g:markdown_viewer_preview_width");
    expect(configVimNameOf("preview.auto_start")).toBe("g:markdown_viewer_auto_start");
  });

  it("renders one four-field message from a rejection", () => {
    const message = configurationErrorMessage({
      key: "scroll.mode",
      expected: "middle|top|relative",
      received: "diagonal",
      source: "g:mkdp_preview_options.sync_scroll_type",
    });

    expect(message).toBe(
      "invalid configuration: key scroll.mode, expected middle|top|relative, received diagonal, source g:mkdp_preview_options.sync_scroll_type",
    );
    expect(message).not.toContain("undefined");
    expect(CONFIG_ERROR_FORMAT).toContain("%s");
  });

  it("rejects a value outside a closed enumeration with the four fields", () => {
    const failure = validateConfigValue(
      "scroll.mode",
      "diagonal",
      "g:mkdp_preview_options.sync_scroll_type",
    );

    expect(failure).toEqual({
      key: "scroll.mode",
      expected: "middle|top|relative",
      received: "diagonal",
      source: "g:mkdp_preview_options.sync_scroll_type",
    });
    expect(validateConfigValue("scroll.mode", "top")).toBeNull();
  });

  it("rejects a wrong type and accepts a null for every key", () => {
    expect(validateConfigValue("preview.auto_start", "yes")?.expected).toBe("boolean");
    expect(validateConfigValue("server.port", "3000")?.expected).toBe("number");
    expect(validateConfigValue("preview.width", 42)?.received).toBe("42");
    expect(validateConfigValue("preview.width", true)?.received).toBe("true");
    expect(validateConfigValue("preview.filetypes", "markdown")?.expected).toBe("string-list");
    expect(validateConfigValue("preview.filetypes", ["markdown", 1])?.expected).toBe("string-list");
    expect(validateConfigValue("preview.width", null)).toBeNull();
    expect(validateConfigValue("server.port", null)).toBeNull();
  });

  it("rejects an unknown key", () => {
    expect(validateConfigValue("preview.invented", 1)?.key).toBe("preview.invented");
  });

  it("names a received number and boolean instead of nil", () => {
    expect(validateConfigValue("preview.width", 42)?.received).toBe("42");
    expect(validateConfigValue("preview.width", false)?.received).toBe("false");
  });
});
