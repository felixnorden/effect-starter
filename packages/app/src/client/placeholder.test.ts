import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { installImageFallback } from "./controls.ts";
import {
  placeholderFor,
  placeholderFrom,
  replaceWithPlaceholder,
  type PlaceholderDescription,
} from "./placeholder.ts";

type ClientCase = {
  readonly producer: string;
  readonly source: string;
  readonly resolved: string;
  readonly alt: string;
  readonly width: string;
  readonly height: string;
  readonly expect: { readonly width: string; readonly height: string };
};

type Contract = {
  readonly marker: { readonly property: string; readonly attribute: string };
  readonly authoredSource: { readonly property: string; readonly attribute: string };
  readonly resolvedPath: { readonly property: string; readonly attribute: string };
  readonly accessibleName: {
    readonly property: string;
    readonly attribute: string;
    readonly role: string;
  };
  readonly box: { readonly property: string; readonly attribute: string };
  readonly cases: readonly ClientCase[];
};

const contract = JSON.parse(
  readFileSync(new URL("../../../../fixtures/placeholder-cases.json", import.meta.url), "utf8"),
) as Contract;

const clientCases = contract.cases.filter((entry) => entry.producer === "client");

type FakeImage = {
  readonly attributes: Record<string, string>;
  isConnected: boolean;
  complete?: boolean;
  naturalWidth?: number;
  getAttribute: (name: string) => string | null;
  replaceWith: (element: Element) => void;
};

const fakeImage = (attributes: Record<string, string> = {}, connected = true): FakeImage => ({
  attributes,
  isConnected: connected,
  getAttribute: (name) => attributes[name] ?? null,
  replaceWith: () => {
    // A real replacement detaches the old image.
  },
});

const asElement = (image: FakeImage): Element => image as unknown as Element;

const capture = (): {
  readonly factory: (description: PlaceholderDescription) => Element;
  readonly description: () => PlaceholderDescription | null;
} => {
  let captured: PlaceholderDescription | null = null;
  return {
    factory: (description) => {
      captured = description;
      return {} as Element;
    },
    description: () => captured,
  };
};

describe("placeholderFor", () => {
  it("builds the contract shape for every client case", () => {
    for (const entry of clientCases) {
      const description = placeholderFor(
        entry.source,
        entry.resolved,
        { width: entry.width, height: entry.height },
        entry.alt,
      );

      const expected: Record<string, string> = {
        [contract.marker.attribute]: "",
        [contract.authoredSource.attribute]: entry.source,
        [contract.resolvedPath.attribute]: entry.resolved,
        role: contract.accessibleName.role,
        ...(entry.alt === "" ? {} : { [contract.accessibleName.attribute]: entry.alt }),
        [contract.box.attribute]: `width:${entry.expect.width};height:${entry.expect.height}`,
      };

      expect(description.tagName).toBe("span");
      expect(description.attributes).toEqual(expected);
      expect(description.text).toBe(entry.resolved);
    }
  });

  it("keeps the declared box", () => {
    expect(
      placeholderFor("a.png", "/local/a.png", { width: "120", height: "80" }, "").attributes,
    ).toMatchObject({ style: "width:120px;height:80px" });
    expect(placeholderFor("b.png", "/local/b.png", { width: "50%" }, "").attributes).toMatchObject({
      style: "width:50%",
    });
  });
});

describe("replaceWithPlaceholder", () => {
  it("keeps the authored alt as the accessible name", () => {
    const withAlt = capture();
    replaceWithPlaceholder(
      asElement(fakeImage({ "data-mdv-source": "a.png", src: "/local/a.png", alt: "diagram" })),
      withAlt.factory,
    );
    expect(withAlt.description()?.attributes).toMatchObject({
      role: "img",
      "aria-label": "diagram",
      "data-mdv-resolved": "/local/a.png",
    });

    const withoutAlt = capture();
    replaceWithPlaceholder(
      asElement(fakeImage({ "data-mdv-source": "a.png", src: "/local/a.png" })),
      withoutAlt.factory,
    );
    expect(withoutAlt.description()?.attributes.role).toBe("img");
    expect(withoutAlt.description()?.attributes).not.toHaveProperty("aria-label");
  });

  it("never invents a path for an unstamped image", () => {
    expect(placeholderFrom(asElement(fakeImage({ src: "/local/a.png" })))).toBeNull();
  });

  it("does not replace an element twice", () => {
    const image = fakeImage({ "data-mdv-source": "a.png", src: "/local/a.png" });
    const captured = capture();
    image.replaceWith = () => {
      image.isConnected = false;
    };

    replaceWithPlaceholder(asElement(image), captured.factory);
    replaceWithPlaceholder(asElement(image), captured.factory);

    expect(captured.description()).not.toBeNull();
    let calls = 0;
    const counting = (description: PlaceholderDescription): Element => {
      calls += 1;
      return captured.factory(description);
    };
    replaceWithPlaceholder(asElement(image), counting);
    expect(calls).toBe(0);
  });
});

describe("installImageFallback", () => {
  const fakeContainer = (images: readonly Element[]) => {
    const listeners: Array<{ type: string; listener: EventListener; capture: boolean }> = [];
    const element = {
      addEventListener: (type: string, listener: EventListener, capture: boolean) => {
        listeners.push({ type, listener, capture });
      },
      removeEventListener: (type: string, listener: EventListener) => {
        const index = listeners.findIndex(
          (entry) => entry.listener === listener && entry.type === type,
        );
        if (index !== -1) listeners.splice(index, 1);
      },
      querySelectorAll: (selector: string) => (selector === "img" ? images : []),
    } as unknown as HTMLElement;
    return { element, listeners };
  };

  it("replaces an image that failed before the listener existed", () => {
    const failed = { ...fakeImage({}), complete: true, naturalWidth: 0 } as unknown as Element;
    const loaded = { ...fakeImage({}), complete: true, naturalWidth: 4 } as unknown as Element;
    const { element } = fakeContainer([failed, loaded]);
    const replaced: Element[] = [];

    const remove = installImageFallback(element, (image) => replaced.push(image));

    expect(replaced).toEqual([failed]);
    remove();
  });

  it("listens in the capture phase and removes the same listener", () => {
    const { element, listeners } = fakeContainer([]);

    const remove = installImageFallback(element, () => {});
    expect(listeners).toHaveLength(1);
    expect(listeners[0]).toMatchObject({ type: "error", capture: true });

    const listener = listeners[0]?.listener;
    remove();
    expect(listeners).toHaveLength(0);
    expect(listener).toBeDefined();
  });
});
