// @effect-diagnostics asyncFunction:off
import { expect, type Page } from "@playwright/test";

/** The header's one control, which opens and closes the settings panel. */
export const PANEL_TOGGLE = "Settings";

/**
 * The panel floats over the page and rests as a rail, so a test that reads or
 * drives one of the five options opens it first.
 */
export const openPanel = async (page: Page): Promise<void> => {
  const toggle = page.getByRole("button", { name: PANEL_TOGGLE, exact: true });
  if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
  await expect(page.locator("#preview-panel")).toHaveAttribute("data-state", "open");
};
