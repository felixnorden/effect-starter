import { randomUUID } from "node:crypto";

/**
 * One mint site, one opaque value. PT-5 later attaches a token to the page
 * address; no consumer parses, rebuilds, or logs this id.
 */
export const mintSessionId = (): string => randomUUID();
