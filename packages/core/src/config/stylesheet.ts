import { createHash } from "node:crypto";

/**
 * A configured stylesheet's address: the slot and the first 16 hex of the
 * file's SHA-256. No path or file name appears in the URL (G-48).
 */
export type StylesheetSlot = "markdown" | "code";

export const stylesheetAddress = (slot: StylesheetSlot, bytes: Uint8Array): string =>
  `/stylesheet/${slot}/${createHash("sha256").update(bytes).digest("hex").slice(0, 16)}`;
