import type { ElementContent } from "hast";

import type { BlockKind, LineRange } from "../model.ts";

/** One top-level block, sanitized, highlighted, and hashed. It carries no id. */
export type Block = {
  readonly range: LineRange;
  readonly kind: BlockKind;
  readonly hash: string;
  readonly hast: readonly ElementContent[];
};

export type DocumentModel = {
  readonly title: string | null;
  readonly optionsHash: string;
  readonly blocks: readonly Block[];
};
