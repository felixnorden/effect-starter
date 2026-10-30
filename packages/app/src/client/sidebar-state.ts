/** The stored panel choice: the full panel, or the rail that keeps the switches. */
export const SIDEBAR_KEY = "preview-sidebar";

export type SidebarState = "open" | "rail";

const isSidebarState = (value: string | null): value is SidebarState =>
  value === "open" || value === "rail";

/** Anything unknown, including a first visit, takes the caller's default. */
export const readSidebarState = (deps: {
  readonly storage: Storage;
  readonly defaultState?: SidebarState;
}): SidebarState => {
  const value = deps.storage.getItem(SIDEBAR_KEY);
  if (isSidebarState(value)) return value;
  return deps.defaultState ?? "open";
};

/** The one write site: flips the state, stores it, and returns the new value. */
export const toggleSidebarState = (
  state: SidebarState,
  deps: { readonly storage: Storage },
): SidebarState => {
  const next: SidebarState = state === "open" ? "rail" : "open";
  deps.storage.setItem(SIDEBAR_KEY, next);
  return next;
};
