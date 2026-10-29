import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { HtmlTagDescriptor } from "vite";

import { prepaint } from "../../vite-plugin-prepaint.ts";
import { PAGE_THEMES } from "./page-theme.ts";

const clientDir = fileURLToPath(new URL(".", import.meta.url));
const indexHtml = readFileSync(path.join(clientDir, "index.html"), "utf8");

type Handler = (html: string) => readonly HtmlTagDescriptor[];

const injectedTags = (): readonly HtmlTagDescriptor[] => {
  const hook = prepaint().transformIndexHtml as unknown as Handler;
  return hook(indexHtml);
};

describe("prepaint", () => {
  it("injects the snippet into the head, before the module script", () => {
    const script = injectedTags().find((tag) => tag.tag === "script");
    const children = script?.children;
    const snippet = typeof children === "string" ? children : "";

    expect(script?.injectTo).toBe("head-prepend");
    expect(snippet).toContain("sessionStorage");
    for (const theme of PAGE_THEMES) expect(snippet).toContain(`"${theme.name}"`);

    const rendered = indexHtml.replace("<head>", `<head><script>${snippet}</script>`);
    const injected = rendered.indexOf(snippet);
    const head = rendered.indexOf("<head>");
    const headEnd = rendered.indexOf("</head>");
    const moduleScript = rendered.indexOf('<script type="module"');

    expect(injected).toBeGreaterThan(head);
    expect(injected).toBeLessThan(headEnd);
    expect(injected).toBeLessThan(moduleScript);
  });
});
