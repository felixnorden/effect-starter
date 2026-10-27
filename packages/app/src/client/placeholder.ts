/** The core shape, re-expressed for the DOM; checked against placeholder-cases.json. */
export type PlaceholderDescription = {
  readonly tagName: "span";
  readonly attributes: Record<string, string>;
  readonly text: string;
};

export type PlaceholderSize = { readonly width?: string; readonly height?: string };

/** Core's rule, repeated: a bare number becomes pixels, anything else verbatim. */
const boxDeclarations = (size: PlaceholderSize): string =>
  Object.entries({ width: size.width, height: size.height })
    .filter(([, value]) => value !== undefined && value !== "")
    .map(([name, value]) => `${name}:${/^\d+$/u.test(value ?? "") ? `${value}px` : value}`)
    .join(";");

export const placeholderFor = (
  source: string,
  resolved: string,
  size: PlaceholderSize,
  alt: string,
): PlaceholderDescription => {
  const box = boxDeclarations(size);
  return {
    tagName: "span",
    attributes: {
      "data-mdv-placeholder": "",
      "data-mdv-source": source,
      "data-mdv-resolved": resolved,
      role: "img",
      ...(alt === "" ? {} : { "aria-label": alt }),
      ...(box === "" ? {} : { style: box }),
    },
    text: resolved,
  };
};

const attribute = (element: Element, name: string): string => element.getAttribute(name) ?? "";

/** Reads the stamp, the mapped `src`, the `alt`, and the declared box. */
export const placeholderFrom = (image: Element): PlaceholderDescription | null => {
  const source = image.getAttribute("data-mdv-source");
  if (source === null) return null;

  return placeholderFor(
    source,
    image.getAttribute("src") ?? image.getAttribute("data-mdv-resolved") ?? source,
    {
      width: attribute(image, "width"),
      height: attribute(image, "height"),
    },
    attribute(image, "alt"),
  );
};

export type PlaceholderFactory = (description: PlaceholderDescription) => Element;

const createElement = (description: PlaceholderDescription): Element => {
  const element = document.createElement(description.tagName);
  for (const [name, value] of Object.entries(description.attributes)) {
    element.setAttribute(name, value);
  }
  element.textContent = description.text;
  return element;
};

/**
 * Replaces one failed image. An image without the stamp is left alone, and a
 * detached element (already swapped, or removed by a rerender) is not touched.
 */
export const replaceWithPlaceholder = (
  image: Element,
  create: PlaceholderFactory = createElement,
): void => {
  if (!image.isConnected) return;
  const description = placeholderFrom(image);
  if (description === null) return;
  image.replaceWith(create(description));
};
