import {
  configClassOf,
  configDefaults,
  configKeys,
  configurationErrorMessage,
  validateConfigValue,
  type ConfigRejection,
  type ConfigValueClass,
} from "./declaration.ts";

/** One resolved key: its value and the carrier spelling that produced it. */
export type NormalizedValue = {
  readonly value: unknown;
  readonly source: string;
};

export type NormalizedConfiguration = {
  readonly values: Readonly<Record<string, NormalizedValue>>;
};

export type ConfigurationRejection = ConfigRejection & {
  readonly reason: "shape" | "unknown" | "not-sendable" | "type";
};

export type ConfigurationValidation =
  | { readonly ok: true; readonly config: NormalizedConfiguration }
  | { readonly ok: false; readonly rejection: ConfigurationRejection };

const declaredBy = new Map(configKeys().map((key) => [key.name, key]));

const defaults = (): NormalizedConfiguration => ({
  values: Object.fromEntries(
    configKeys()
      .filter((key) => !key.container)
      .map((key) => [key.name, { value: configDefaults[key.name], source: "default" }]),
  ),
});

const rejectionOf = (
  reason: ConfigurationRejection["reason"],
  key: string,
  expected: string,
  received: string,
  source: string,
): ConfigurationRejection => ({ reason, key, expected, received, source });

const receivedText = (value: unknown): string =>
  typeof value === "string" ? value : (JSON.stringify(value) ?? "nil");

/** The server-owned classes a configuration frame may change. */
const sendable = (valueClass: ConfigValueClass | null): boolean =>
  valueClass === "render" || valueClass === "page-display";

type Entry = {
  readonly key: string;
  readonly value: unknown;
  readonly source: string;
};

const entriesOf = (values: unknown): readonly Entry[] | null => {
  if (!Array.isArray(values)) return null;
  const entries: Entry[] = [];

  for (const candidate of values) {
    if (candidate === null || typeof candidate !== "object") return null;
    const record = candidate as Record<string, unknown>;
    if (typeof record.key !== "string" || typeof record.source !== "string") return null;
    entries.push({ key: record.key, value: record.value, source: record.source });
  }

  return entries;
};

/**
 * Re-validate one configuration frame's values against the declaration.
 *
 * A frame replaces the cell: an omitted key is the declaration's default. Only
 * `render` and `page-display` may change live; `endpoint` values are handled by
 * the session as "next start"; `editor`, `process` and the container row are
 * not sendable.
 */
export const validateConfiguration = (values: unknown): ConfigurationValidation => {
  const entries = entriesOf(values);
  if (entries === null) {
    return {
      ok: false,
      rejection: rejectionOf("shape", "values", "an array of keyed values", "other", "frame"),
    };
  }

  const config = defaults();

  for (const entry of entries) {
    const declared = declaredBy.get(entry.key);
    if (declared === undefined) {
      return {
        ok: false,
        rejection: rejectionOf(
          "unknown",
          entry.key,
          "a declared key",
          receivedText(entry.value),
          entry.source,
        ),
      };
    }

    if (declared.container) {
      return {
        ok: false,
        rejection: rejectionOf(
          "not-sendable",
          entry.key,
          "a server-owned key",
          receivedText(entry.value),
          entry.source,
        ),
      };
    }

    if (!sendable(configClassOf(entry.key))) {
      return {
        ok: false,
        rejection: rejectionOf(
          "not-sendable",
          entry.key,
          "a server-owned key",
          receivedText(entry.value),
          entry.source,
        ),
      };
    }

    const failure = validateConfigValue(entry.key, entry.value, entry.source);
    if (failure !== null) {
      return { ok: false, rejection: { ...failure, reason: "type" } };
    }

    (config.values as Record<string, NormalizedValue>)[entry.key] = {
      value: entry.value,
      source: entry.source,
    };
  }

  return { ok: true, config };
};

/** The one message for a rejected frame. */
export const rejectionMessage = (rejection: ConfigurationRejection): string =>
  configurationErrorMessage(rejection);
