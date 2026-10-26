import type { ElementContent } from "hast";
import { toHtml } from "hast-util-to-html";
import { createHash } from "node:crypto";

/**
 * Hash the exact subtree the client receives, salted with the options hash. The
 * hash is taken last so it always means "the client would display exactly this".
 *
 * `node:crypto`, not `Bun.hash`: core tests run in the Node Vitest pool.
 */
export const hashBlock = (hast: readonly ElementContent[], optionsHash: string): string =>
  createHash("sha256")
    .update(toHtml([...hast]))
    .update("\u0000")
    .update(optionsHash)
    .digest("hex")
    .slice(0, 16);
