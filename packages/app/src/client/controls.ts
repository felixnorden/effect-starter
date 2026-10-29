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
const COPY_TABLE = "[data-mdv-copy-table]";
const COPY_LINK = "[data-mdv-copy-link]";
const COPY_URL = "[data-mdv-copy-url]";
const LABEL = "[data-mdv-label]";
const CONTROL_LABEL = "Copy";
const COPIED_LABEL = "Copied";
const FAILED_LABEL = "Copy failed";
const EMPTY_LABEL = "Nothing to copy";
const FLASH_MS = 1200;

const STATE_ATTRIBUTE = "data-mdv-state";

type Kind = "code" | "table" | "link" | "url";
type FlashState = "copied" | "failed" | "empty";
type Flash = { readonly generation: number; readonly handle?: unknown };

/** One timer per control, so a double click cannot leave a stale restore pending. */
const flashes = new WeakMap<Element, Flash>();

const closestControl = (target: unknown, selector: string): Element | null => {
  if (target === null || typeof target !== "object") return null;
  const candidate = target as { closest?: (selector: string) => Element | null };
  return typeof candidate.closest === "function" ? candidate.closest(selector) : null;
};

/** The four kinds, in the order a click is routed. */
const controlAt = (target: unknown): { readonly control: Element; readonly kind: Kind } | null => {
  for (const [kind, selector] of [
    ["link", COPY_LINK],
    ["url", COPY_URL],
    ["code", COPY_CODE],
    ["table", COPY_TABLE],
  ] as const) {
    const control = closestControl(target, selector);
    if (control !== null) return { control, kind };
  }
  return null;
};

/** One fragment, no doubled `#`, and the browser decodes the id back for the jump. */
const headingUrl = (href: string, id: string): string => {
  const url = new URL(href);
  url.hash = id;
  return url.href;
};

/** Rows tab-separated, rows newline-separated. */
const rowsOf = (block: Element | null): string | null => {
  const rows = block?.querySelectorAll("tr") ?? [];
  if (rows.length === 0) return null;

  const lines = [...rows].map((row) =>
    [...row.querySelectorAll("td, th")].map((cell) => (cell.textContent ?? "").trim()).join("\t"),
  );
  return lines.join("\n");
};

/** The payload for a kind, or null when there is nothing to copy. */
const payloadOf = (control: Element, kind: Kind, deps: ControlDeps): string | null => {
  if (kind === "link") {
    const id = control.getAttribute("data-mdv-copy-link");
    return id === null ? null : headingUrl(deps.location.href, id);
  }
  if (kind === "url") {
    const href = control.getAttribute("data-mdv-copy-url");
    return href === null ? null : new URL(href, deps.location.href).href;
  }

  const block = control.closest("[data-block-id]");
  if (kind === "code") {
    const text = block?.querySelector("code")?.textContent ?? "";
    return text === "" ? null : text;
  }
  return rowsOf(block);
};

/** Text controls flash a label span; icon controls swap their glyph. */
const showState = (control: Element, state: FlashState | null): void => {
  const label = control.querySelector(LABEL);
  if (label !== null) {
    label.textContent =
      state === null
        ? CONTROL_LABEL
        : state === "copied"
          ? COPIED_LABEL
          : state === "failed"
            ? FAILED_LABEL
            : EMPTY_LABEL;
    return;
  }

  if (state === "copied") control.setAttribute(STATE_ATTRIBUTE, "copied");
  else control.removeAttribute(STATE_ATTRIBUTE);
};

/** Start a generation and cancel the pending restore it supersedes. */
const beginFlash = (control: Element, deps: ControlDeps): number => {
  const current = flashes.get(control);
  if (current?.handle !== undefined) deps.timers.clearTimeout(current.handle);
  const generation = (current?.generation ?? 0) + 1;
  flashes.set(control, { generation });
  return generation;
};

/** Show a state, then restore the control's own label unless a newer flash won. */
const flash = (
  control: Element,
  deps: ControlDeps,
  generation: number,
  state: FlashState,
): void => {
  if (flashes.get(control)?.generation !== generation) return;
  showState(control, state);

  const handle = deps.timers.setTimeout(() => {
    if (flashes.get(control)?.generation !== generation) return;
    showState(control, null);
    flashes.delete(control);
  }, FLASH_MS);
  flashes.set(control, { generation, handle });
};

/** The delegated click handler: every control is a sibling of the content it copies. */
export const handleContentClick = (
  event: { readonly target: unknown },
  deps: ControlDeps,
): void => {
  const found = controlAt(event.target);
  if (found === null) return;

  const { control, kind } = found;
  const payload = payloadOf(control, kind, deps);
  const generation = beginFlash(control, deps);

  if (payload === null) {
    flash(control, deps, generation, "empty");
    deps.status.textContent = EMPTY_LABEL;
    return;
  }

  void deps.clipboard.writeText(payload).then(
    () => flash(control, deps, generation, "copied"),
    () => {
      flash(control, deps, generation, "failed");
      deps.status.textContent = FAILED_LABEL;
    },
  );
};
