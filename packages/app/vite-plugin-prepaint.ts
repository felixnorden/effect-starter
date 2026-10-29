import type { Plugin } from "vite";

import { prePaintScript } from "./src/client/boot-snippet.ts";

/** Inline the pre-paint snippet into the head, from one source of truth. */
export const prepaint = (): Plugin => ({
  name: "mdv-prepaint",
  transformIndexHtml: () => [{ tag: "script", children: prePaintScript, injectTo: "head-prepend" }],
});
