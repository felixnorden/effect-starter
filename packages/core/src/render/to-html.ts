import type { Block, DocumentModel } from "./document.ts";
import { toHtml } from "hast-util-to-html";

/** A single-line preview for tables and logs. */
export const blockToHtml = (block: Block): string =>
  toHtml([...block.hast]).replace(/\s*\n\s*/gu, " ");

export const documentToHtml = (document: DocumentModel): string =>
  document.blocks
    .map((block) => toHtml([...block.hast]))
    .filter((html) => html !== "")
    .join("\n");
