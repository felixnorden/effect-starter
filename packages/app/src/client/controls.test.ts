// @effect-diagnostics asyncFunction:off
// @effect-diagnostics strictEffectProvide:off
import { CodeHighlighting, defaultRenderOptions, Renderer } from "@mdv/core";
import { Effect, Layer } from "effect";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { handleContentClick, type ControlDeps } from "./controls.ts";

type ClickTarget = Parameters<typeof handleContentClick>[0]["target"];

const targetOf = (control: unknown): ClickTarget => control as ClickTarget;

/** A text control: a block-level cluster whose label span carries the message. */
const fence = (text: string) => {
  const label = { textContent: "Copy" };
  const code = { textContent: text };
  const block = {
    querySelector: (selector: string) => (selector === "code" ? code : null),
  };
  const button: Record<string, unknown> = {
    getAttribute: () => null,
    setAttribute: () => {},
    removeAttribute: () => {},
    querySelector: (selector: string) => (selector === "[data-mdv-label]" ? label : null),
  };
  button["closest"] = (selector: string) =>
    selector === "[data-mdv-copy-code]" ? button : selector === "[data-block-id]" ? block : null;
  return { button, code, block, label };
};

const table = (rows: readonly (readonly string[])[]) => {
  const label = { textContent: "Copy" };
  const block = {
    querySelectorAll: (selector: string) =>
      selector === "tr"
        ? rows.map((cells) => ({
            querySelectorAll: (inner: string) =>
              inner === "td, th" ? cells.map((text) => ({ textContent: text })) : [],
          }))
        : [],
  };
  const button: Record<string, unknown> = {
    getAttribute: () => null,
    setAttribute: () => {},
    removeAttribute: () => {},
    querySelector: (selector: string) => (selector === "[data-mdv-label]" ? label : null),
  };
  button["closest"] = (selector: string) =>
    selector === "[data-mdv-copy-table]" ? button : selector === "[data-block-id]" ? block : null;
  return { button, block, label };
};

/** An icon control: no label span, so the flash swaps the glyph attribute. */
const iconControl = (selector: string, attribute: string, value: string) => {
  const attributes = new Map<string, string>();
  const button: Record<string, unknown> = {
    getAttribute: (name: string) => (name === attribute ? value : (attributes.get(name) ?? null)),
    setAttribute: (name: string, value: string) => {
      attributes.set(name, value);
    },
    removeAttribute: (name: string) => {
      attributes.delete(name);
    },
    querySelector: () => null,
  };
  button["closest"] = (candidate: string) => (candidate === selector ? button : null);
  return { button, attributes };
};

const clipboardSpy = (fail = false) => {
  const writes: string[] = [];
  return {
    writes,
    clipboard: {
      writeText: async (text: string) => {
        writes.push(text);
        if (fail) throw new Error("denied");
      },
    },
  };
};

const fakeTimers = () => {
  const pending = new Map<number, { callback: () => void; ms: number }>();
  let next = 1;
  return {
    pending,
    timers: {
      setTimeout: (callback: () => void, ms: number) => {
        const handle = next;
        next += 1;
        pending.set(handle, {
          callback: () => {
            pending.delete(handle);
            callback();
          },
          ms,
        });
        return handle;
      },
      clearTimeout: (handle: unknown) => {
        pending.delete(handle as number);
      },
    },
  };
};

const depsOf = (
  clipboard: ControlDeps["clipboard"],
  timers: ControlDeps["timers"],
  status: { textContent: string | null } = { textContent: null },
  location: { readonly href: string } = { href: "http://127.0.0.1:1/" },
): ControlDeps => ({
  clipboard,
  location,
  status,
  timers,
});

const headingIdsOf = (hast: readonly unknown[]): string[] => {
  const ids: string[] = [];
  const walk = (node: unknown): void => {
    if (typeof node !== "object" || node === null) return;
    const record = node as {
      readonly type?: string;
      readonly tagName?: string;
      readonly properties?: { readonly id?: unknown };
      readonly children?: readonly unknown[];
    };
    if (
      record.type === "element" &&
      /^h[2-6]$/u.test(record.tagName ?? "") &&
      typeof record.properties?.id === "string"
    ) {
      ids.push(record.properties.id);
    }
    for (const child of record.children ?? []) walk(child);
  };
  for (const node of hast) walk(node);
  return ids;
};

describe("handleContentClick", () => {
  it("copies the code element's exact text", async () => {
    const source = readFileSync(
      new URL("../../../../fixtures/render-fidelity/code-controls.md", import.meta.url),
      "utf8",
    );
    const fences = [...source.matchAll(/```ts\n([\s\S]*?)```/gu)].map((match) => match[1] ?? "");
    const expected = fences.find((text) => text.split("\n").filter(Boolean).length === 3) ?? "";
    expect(expected).toBe("const x = 1;\nconst y = 2;\nconst z = 3;\n");

    const { button } = fence(expected);
    const { clipboard, writes } = clipboardSpy();
    const { timers } = fakeTimers();

    handleContentClick({ target: targetOf(button) }, depsOf(clipboard, timers));
    await Promise.resolve();

    expect(writes).toEqual([expected]);
  });

  it("ignores a click that is not on a control", () => {
    const { clipboard, writes } = clipboardSpy();
    const { timers } = fakeTimers();

    handleContentClick(
      { target: { closest: () => null } as ClickTarget },
      depsOf(clipboard, timers),
    );

    expect(writes).toEqual([]);
  });

  it("copies a table as tab-separated rows", async () => {
    const { button } = table([
      ["a", "b"],
      ["c", "d"],
    ]);
    const { clipboard, writes } = clipboardSpy();
    const { timers } = fakeTimers();

    handleContentClick({ target: targetOf(button) }, depsOf(clipboard, timers));
    await Promise.resolve();

    expect(writes).toEqual(["a\tb\nc\td"]);
  });

  it("copies an inline link's absolute address", async () => {
    const { button } = iconControl("[data-mdv-copy-url]", "data-mdv-copy-url", "/local/notes.md");
    const { clipboard, writes } = clipboardSpy();
    const { timers } = fakeTimers();

    handleContentClick(
      { target: targetOf(button) },
      depsOf(clipboard, timers, { textContent: null }, { href: "http://localhost:4321/preview" }),
    );
    await Promise.resolve();

    expect(writes).toEqual(["http://localhost:4321/local/notes.md"]);
  });

  it("copies the heading's absolute URL, built from the existing id", async () => {
    const { clipboard, writes } = clipboardSpy();
    const { timers } = fakeTimers();
    const { button } = iconControl("[data-mdv-copy-link]", "data-mdv-copy-link", "same-1");

    handleContentClick({ target: targetOf(button) }, depsOf(clipboard, timers));
    await Promise.resolve();

    expect(writes).toEqual(["http://127.0.0.1:1/#same-1"]);
  });

  it("keeps a query string and replaces an existing fragment", async () => {
    const { clipboard, writes } = clipboardSpy();
    const { timers } = fakeTimers();
    const { button } = iconControl("[data-mdv-copy-link]", "data-mdv-copy-link", "same-1");

    handleContentClick(
      { target: targetOf(button) },
      depsOf(
        clipboard,
        timers,
        { textContent: null },
        {
          href: "http://127.0.0.1:1/?file=a.md#old",
        },
      ),
    );
    await Promise.resolve();

    expect(writes).toEqual(["http://127.0.0.1:1/?file=a.md#same-1"]);
  });

  it("gives duplicate headings two different URLs", async () => {
    const source = readFileSync(
      new URL("../../../../fixtures/render-fidelity/duplicate-headings.md", import.meta.url),
      "utf8",
    );
    const document = await Effect.runPromise(
      Effect.gen(function* () {
        const renderer = yield* Renderer;
        return yield* renderer.render(source, defaultRenderOptions);
      }).pipe(Effect.provide(Renderer.layer.pipe(Layer.provide(CodeHighlighting.layer)))),
    );
    const ids = headingIdsOf(document.blocks.flatMap((block) => block.hast));
    const duplicates = ids.filter((id) => id.startsWith("same"));
    expect(duplicates).toHaveLength(2);

    const { clipboard, writes } = clipboardSpy();
    const { timers } = fakeTimers();
    const deps = depsOf(clipboard, timers);
    for (const id of duplicates) {
      const { button } = iconControl("[data-mdv-copy-link]", "data-mdv-copy-link", id);
      handleContentClick({ target: targetOf(button) }, deps);
    }
    await Promise.resolve();

    expect(writes).toEqual(duplicates.map((id) => `http://127.0.0.1:1/#${id}`));
    expect(new Set(writes).size).toBe(2);
  });

  it("copies only the fence the clicked button belongs to", async () => {
    const first = fence("first\n");
    const second = fence("second\n");
    const { clipboard, writes } = clipboardSpy();
    const { timers } = fakeTimers();

    handleContentClick({ target: targetOf(second.button) }, depsOf(clipboard, timers));
    await Promise.resolve();

    expect(writes).toEqual(["second\n"]);
    expect(first.label.textContent).toBe("Copy");
  });

  it("separates a failure from an empty payload", async () => {
    const { button, label } = fence("code\n");
    const { clipboard } = clipboardSpy(true);
    const { timers } = fakeTimers();
    const status = { textContent: null };

    handleContentClick({ target: targetOf(button) }, depsOf(clipboard, timers, status));
    await Promise.resolve();
    await Promise.resolve();

    expect(label.textContent).toBe("Copy failed");
    expect(status.textContent).toBe("Copy failed");

    const empty = fence("");
    const emptyClipboard = clipboardSpy();
    const emptyStatus = { textContent: null };
    handleContentClick(
      { target: targetOf(empty.button) },
      depsOf(emptyClipboard.clipboard, timers, emptyStatus),
    );
    await Promise.resolve();

    expect(empty.label.textContent).toBe("Nothing to copy");
    expect(emptyStatus.textContent).toBe("Nothing to copy");
    expect(emptyClipboard.writes).toEqual([]);
  });

  it("shows Copied on success and restores the kind's own label", async () => {
    const { button, label } = fence("code\n");
    const { clipboard } = clipboardSpy();
    const { timers, pending } = fakeTimers();

    handleContentClick({ target: targetOf(button) }, depsOf(clipboard, timers));
    await Promise.resolve();

    expect(label.textContent).toBe("Copied");
    expect(pending.size).toBe(1);

    const [entry] = [...pending.values()];
    entry?.callback();
    expect(label.textContent).toBe("Copy");
  });

  it("swaps the icon glyph on success and restores it when the timer fires", async () => {
    const { button, attributes } = iconControl(
      "[data-mdv-copy-link]",
      "data-mdv-copy-link",
      "same-1",
    );
    const { clipboard } = clipboardSpy();
    const { timers, pending } = fakeTimers();

    handleContentClick({ target: targetOf(button) }, depsOf(clipboard, timers));
    await Promise.resolve();

    expect(attributes.get("data-mdv-state")).toBe("copied");

    const [entry] = [...pending.values()];
    entry?.callback();
    expect(attributes.has("data-mdv-state")).toBe(false);
  });

  it("does not restore a newer flash with an older generation", async () => {
    const { button, label } = fence("code\n");
    const { clipboard } = clipboardSpy();
    const { timers, pending } = fakeTimers();
    const deps = depsOf(clipboard, timers);

    handleContentClick({ target: targetOf(button) }, deps);
    await Promise.resolve();
    const [first] = [...pending.values()];

    handleContentClick({ target: targetOf(button) }, deps);
    await Promise.resolve();
    expect(pending.size).toBe(1);

    first?.callback();
    expect(label.textContent).toBe("Copied");
  });
});
