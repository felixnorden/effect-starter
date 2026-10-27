import { replaceWithPlaceholder, type PlaceholderFactory } from "./placeholder.ts";

/** An image that finished before the listener was installed. */
const failedBeforeInstall = (image: Element): boolean => {
  const candidate = image as unknown as {
    readonly complete?: boolean;
    readonly naturalWidth?: number;
  };
  return candidate.complete === true && candidate.naturalWidth === 0;
};

/**
 * One capture-phase listener on the content container: `error` does not bubble
 * from an image, and the first sweep catches images that failed before install.
 */
export const installImageFallback = (
  container: HTMLElement,
  replace: (image: Element, create?: PlaceholderFactory) => void = replaceWithPlaceholder,
): (() => void) => {
  const onError = (event: Event): void => {
    const target = event.target;
    if (target === null) return;
    replace(target as Element);
  };

  container.addEventListener("error", onError, true);

  for (const image of container.querySelectorAll("img")) {
    if (failedBeforeInstall(image)) replace(image);
  }

  return () => container.removeEventListener("error", onError, true);
};

export type ControlDeps = {
  readonly clipboard: { writeText(text: string): Promise<void> };
  readonly location: { readonly href: string };
  readonly status: { textContent: string | null };
  readonly timers: {
    setTimeout(callback: () => void, ms: number): unknown;
    clearTimeout(handle: unknown): void;
  };
};

const COPY_CODE = "[data-mdv-copy-code]";
const COPY_LINK = "[data-mdv-copy-link]";
const COPY_LABEL = "Copy";
const COPIED_LABEL = "Copied";
const FAILED_LABEL = "Copy failed";
const FLASH_MS = 1200;

type Flash = { readonly generation: number; readonly handle?: unknown };

/** One timer per button, so a double click cannot leave a stale restore pending. */
const flashes = new WeakMap<Element, Flash>();

const closestControl = (target: unknown, selector: string): Element | null => {
  if (target === null || typeof target !== "object") return null;
  const candidate = target as { closest?: (selector: string) => Element | null };
  return typeof candidate.closest === "function" ? candidate.closest(selector) : null;
};

/** One fragment, no doubled `#`, and the browser decodes the id back for the jump. */
const headingUrl = (href: string, id: string): string => {
  const url = new URL(href);
  url.hash = id;
  return url.href;
};

/** The delegated click handler: the control is a sibling of block content. */
export const handleContentClick = (
  event: { readonly target: unknown },
  deps: ControlDeps,
): void => {
  const link = closestControl(event.target, COPY_LINK);
  if (link !== null) {
    const id = link.getAttribute("data-mdv-copy-link");
    if (id === null) return;
    void deps.clipboard.writeText(headingUrl(deps.location.href, id)).catch(() => {
      deps.status.textContent = "Copy failed";
    });
    return;
  }

  const button = closestControl(event.target, COPY_CODE);
  if (button === null) return;

  const code = button.closest("[data-block-id]")?.querySelector("code");
  if (code === null || code === undefined) return;

  const current = flashes.get(button);
  if (current?.handle !== undefined) deps.timers.clearTimeout(current.handle);
  const generation = (current?.generation ?? 0) + 1;
  flashes.set(button, { generation });

  void deps.clipboard
    .writeText(code.textContent ?? "")
    .then(() => {
      if (flashes.get(button)?.generation !== generation) return;
      button.textContent = COPIED_LABEL;
      const handle = deps.timers.setTimeout(() => {
        button.textContent = COPY_LABEL;
        flashes.delete(button);
      }, FLASH_MS);
      flashes.set(button, { generation, handle });
    })
    .catch(() => {
      button.textContent = FAILED_LABEL;
      deps.status.textContent = "Copy failed";
    });
};
