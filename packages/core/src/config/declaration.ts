/**
 * The configuration declaration: the one place a §5 key is named.
 *
 * The §5 tables in `docs/requirements.md` are the human document; this module is
 * the machine copy that the generator, the editor interpreters, the server
 * validator, and the documentation test all read. A key is data, never a branch,
 * so the two adapters cannot drift from each other by construction.
 *
 * Pure data plus pure functions: no file system, no environment, no editor.
 */

/** What consumes a key's value. `process` is accepted, validated, never sent. */
export type ConfigValueClass = "editor" | "endpoint" | "render" | "page-display" | "process";

/** Where a baseline alias lives: a top-level `g:` variable or the nested table. */
export type ConfigAliasScope = "global" | "preview_options";

/** One key, declared once. The generator and both intakes read only this. */
export type ConfigKey = {
  readonly name: string;
  /** The Vim variable, pinned in §5.4 under the G-43 spelling rule. */
  readonly vimName: string;
  readonly type: "string" | "number" | "boolean" | "string-list" | "json";
  readonly values: readonly string[];
  readonly default?: unknown;
  readonly alias: string | null;
  readonly aliasScope: ConfigAliasScope | null;
  /** A baseline switch whose meaning is the inverse of the new key's. */
  readonly inverted: boolean;
  readonly class: ConfigValueClass | null;
  readonly container: boolean;
};

/**
 * The one error format. Both interpreters format it, so the four fields arrive
 * in the same order and the same words in Neovim and Vim.
 */
export const CONFIG_ERROR_FORMAT =
  "invalid configuration: key %s, expected %s, received %s, source %s";

export type ConfigRejection = {
  readonly key: string;
  readonly expected: string;
  readonly received: string;
  readonly source: string;
};

const entry = (
  name: string,
  type: ConfigKey["type"],
  options: {
    readonly values?: readonly string[];
    readonly default?: unknown;
    readonly alias?: string | null;
    readonly aliasScope?: ConfigAliasScope | null;
    readonly inverted?: boolean;
    readonly class: ConfigValueClass | null;
    readonly container?: boolean;
    readonly vimName?: string;
  },
): ConfigKey => ({
  name,
  vimName: options.vimName ?? `g:markdown_viewer_${options.alias ?? name.replaceAll(".", "_")}`,
  type,
  values: options.values ?? [],
  ...("default" in options ? { default: options.default } : {}),
  alias: options.alias ?? null,
  aliasScope: options.aliasScope ?? null,
  inverted: options.inverted ?? false,
  class: options.class,
  container: options.container ?? false,
});

/**
 * Sorted by dotted name. §5.1 rows carry a top-level alias; §5.2 rows carry
 * their alias inside `g:mkdp_preview_options`; §5.3 rows add no alias.
 */
const DECLARED: readonly ConfigKey[] = [
  // §5.3 — new settings, no baseline alias.
  entry("assets.allow_remote", "boolean", { default: true, class: "render" }),
  entry("assets.allowlist", "string-list", { default: [], class: "render" }),
  entry("assets.image_root", "string", {
    default: null,
    alias: "images_path",
    aliasScope: "global",
    class: "endpoint",
  }),
  entry("browser.name", "string", {
    default: null,
    alias: "browser",
    aliasScope: "global",
    class: "editor",
  }),
  entry("browser.open_function", "json", {
    default: null,
    alias: "browserfunc",
    aliasScope: "global",
    class: "editor",
  }),
  entry("export.footer", "boolean", { default: false, class: "process" }),
  entry("export.format", "string", { default: "pdf", class: "process" }),
  entry("export.header", "boolean", { default: true, class: "process" }),
  entry("export.margins", "string", { default: "20mm", class: "process" }),
  entry("export.page_size", "string", { default: "A4", class: "process" }),
  entry("export.toc", "boolean", { default: false, class: "process" }),
  entry("logging.level", "string", { default: "warn", class: "process" }),
  // §5.1 — top-level options.
  entry("preview.auto_close", "boolean", {
    default: true,
    alias: "auto_close",
    aliasScope: "global",
    class: "editor",
  }),
  entry("preview.auto_start", "boolean", {
    default: false,
    alias: "auto_start",
    aliasScope: "global",
    class: "editor",
  }),
  entry("preview.combine", "boolean", {
    default: false,
    alias: "combine_preview",
    aliasScope: "global",
    class: "editor",
  }),
  entry("preview.combine_auto_refresh", "boolean", {
    default: true,
    alias: "combine_preview_auto_refresh",
    aliasScope: "global",
    class: "editor",
  }),
  entry("preview.command_for_global", "boolean", {
    default: false,
    alias: "command_for_global",
    aliasScope: "global",
    class: "editor",
  }),
  entry("preview.content_editable", "boolean", {
    default: false,
    alias: "content_editable",
    aliasScope: "preview_options",
    class: "process",
  }),
  entry("preview.filetypes", "string-list", {
    default: ["markdown"],
    alias: "filetypes",
    aliasScope: "global",
    class: "editor",
  }),
  entry("preview.font_size", "string", { default: "16px", class: "page-display" }),
  // The container row: documented, never sent, no value of its own.
  entry("preview.options", "json", {
    alias: "preview_options",
    aliasScope: "global",
    class: null,
    container: true,
  }),
  entry("preview.page_title", "string", {
    default: "「${name}」",
    alias: "page_title",
    aliasScope: "global",
    class: "page-display",
  }),
  entry("preview.refresh_slow", "boolean", {
    default: false,
    alias: "refresh_slow",
    aliasScope: "global",
    class: "editor",
  }),
  entry("preview.show_filename", "boolean", {
    default: true,
    alias: "disable_filename",
    aliasScope: "preview_options",
    inverted: true,
    class: "page-display",
  }),
  entry("preview.width", "string", { default: "900px", class: "page-display" }),
  // §5.2 — the nested render options.
  entry("render.flowchart", "json", {
    default: {},
    alias: "flowchart_diagrams",
    aliasScope: "preview_options",
    class: "render",
  }),
  entry("render.hide_front_matter", "boolean", {
    default: true,
    alias: "hide_yaml_meta",
    aliasScope: "preview_options",
    class: "render",
  }),
  entry("render.katex", "json", {
    default: {},
    alias: "katex",
    aliasScope: "preview_options",
    class: "render",
  }),
  entry("render.markdown_it", "json", {
    default: {},
    alias: "mkit",
    aliasScope: "preview_options",
    class: "render",
  }),
  entry("render.mermaid", "json", {
    default: {},
    alias: "maid",
    aliasScope: "preview_options",
    class: "render",
  }),
  entry("render.plantuml", "json", {
    default: {},
    alias: "uml",
    aliasScope: "preview_options",
    class: "render",
  }),
  entry("render.sequence_diagrams", "json", {
    default: {},
    alias: "sequence_diagrams",
    aliasScope: "preview_options",
    class: "render",
  }),
  entry("render.toc", "json", {
    default: {},
    alias: "toc",
    aliasScope: "preview_options",
    class: "render",
  }),
  entry("scroll.enabled", "boolean", {
    default: true,
    alias: "disable_sync_scroll",
    aliasScope: "preview_options",
    inverted: true,
    class: "editor",
  }),
  entry("scroll.mode", "string", {
    default: "middle",
    values: ["middle", "top", "relative"],
    alias: "sync_scroll_type",
    aliasScope: "preview_options",
    class: "page-display",
  }),
  entry("scroll.smooth", "boolean", { default: true, class: "page-display" }),
  entry("security.allow_html", "boolean", { default: true, class: "render" }),
  entry("server.echo_url", "boolean", {
    default: false,
    alias: "echo_preview_url",
    aliasScope: "global",
    class: "endpoint",
  }),
  entry("server.open_ip", "string", {
    default: "",
    alias: "open_ip",
    aliasScope: "global",
    class: "endpoint",
  }),
  entry("server.open_to_the_world", "boolean", {
    default: false,
    alias: "open_to_the_world",
    aliasScope: "global",
    class: "endpoint",
  }),
  entry("server.port", "number", {
    default: null,
    alias: "port",
    aliasScope: "global",
    class: "endpoint",
  }),
  entry("theme.code_css", "string", {
    default: null,
    alias: "highlight_css",
    aliasScope: "global",
    class: "page-display",
  }),
  entry("theme.code_dark", "string", { default: null, class: "process" }),
  entry("theme.code_light", "string", { default: null, class: "process" }),
  entry("theme.markdown_css", "string", {
    default: null,
    alias: "markdown_css",
    aliasScope: "global",
    class: "page-display",
  }),
  entry("theme.mode", "string", {
    default: "system",
    values: ["system", "light", "dark"],
    alias: "theme",
    aliasScope: "global",
    class: "page-display",
  }),
  entry("theme.print", "string", { default: "light", class: "process" }),
];

/** Every declared key, sorted by dotted name, the container row included. */
export const configKeys = (): readonly ConfigKey[] =>
  [...DECLARED].toSorted((left, right) => left.name.localeCompare(right.name));

const byName = (): ReadonlyMap<string, ConfigKey> =>
  new Map(DECLARED.map((declared) => [declared.name, declared]));

const lookup = (name: string): ConfigKey | null => byName().get(name) ?? null;

/** The declared defaults, keyed by dotted name; the container is absent. */
export const configDefaults: Readonly<Record<string, unknown>> = Object.fromEntries(
  DECLARED.filter((declared) => !declared.container).map((declared) => [
    declared.name,
    declared.default,
  ]),
);

export const configClassOf = (name: string): ConfigValueClass | null => lookup(name)?.class ?? null;

export const configAliasOf = (name: string): string | null => lookup(name)?.alias ?? null;

export const configVimNameOf = (name: string): string | null => lookup(name)?.vimName ?? null;

const expectedText = (declared: ConfigKey): string =>
  declared.values.length > 0 ? declared.values.join("|") : declared.type;

const receivedText = (value: unknown): string => {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value === null) return "nil";
  if (Array.isArray(value)) return `[${value.map(receivedText).join(", ")}]`;
  if (typeof value === "object") return JSON.stringify(value);
  if (typeof value === "function") return "function";
  if (typeof value === "symbol") return "symbol";
  if (typeof value === "bigint") return value.toString();
  return "nil";
};

const typeMatches = (declared: ConfigKey, value: unknown): boolean => {
  if (declared.values.length > 0) {
    return typeof value === "string" && declared.values.includes(value);
  }
  switch (declared.type) {
    case "string":
      return typeof value === "string";
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "boolean":
      return typeof value === "boolean";
    case "string-list":
      return Array.isArray(value) && value.every((item) => typeof item === "string");
    case "json":
      return typeof value === "object" || typeof value === "function";
  }
};

/**
 * One value against its declaration. A `null` is the unset sentinel and always
 * passes. Returns the four-field rejection, or `null` when the value is sound.
 */
export const validateConfigValue = (
  name: string,
  value: unknown,
  source = "default",
): ConfigRejection | null => {
  const declared = lookup(name);

  if (declared === null) {
    return {
      key: name,
      expected: "a declared key",
      received: receivedText(value),
      source,
    };
  }

  if (declared.container || declared.class === null) {
    return {
      key: name,
      expected: "a value key",
      received: receivedText(value),
      source,
    };
  }

  if (value === null) return null;

  if (!typeMatches(declared, value)) {
    return {
      key: name,
      expected: expectedText(declared),
      received: receivedText(value),
      source,
    };
  }

  return null;
};

/** One message from one rejection. Both editors format the same declaration. */
export const configurationErrorMessage = (rejection: ConfigRejection): string => {
  const fields = [rejection.key, rejection.expected, rejection.received, rejection.source];
  let index = 0;
  return CONFIG_ERROR_FORMAT.replaceAll("%s", () => fields[index++] ?? "");
};
