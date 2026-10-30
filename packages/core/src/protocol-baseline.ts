/**
 * The additive-only wire rule, written once and applied by both tripwires.
 *
 * A pinned baseline entry must still exist with the same field names, order and
 * optionality. A schema tag or field outside the baseline passes only when the
 * same commit lists it in the additive set. A breaking edit therefore fails even
 * after a regenerate, while an additive one passes at the same version.
 */

export type WireShape = {
  readonly tag: string;
  readonly fields: readonly string[];
  readonly optionalFields: readonly string[];
};

export type WireBaseline = {
  readonly version: number;
  readonly tags: readonly string[];
  readonly fields: Readonly<Record<string, readonly string[]>>;
  readonly optionalFields: Readonly<Record<string, readonly string[]>>;
  readonly stages: readonly string[];
};

export type WireAdditive = {
  readonly tags: readonly string[];
  readonly fields: Readonly<Record<string, readonly string[]>>;
  readonly optionalFields: Readonly<Record<string, readonly string[]>>;
  readonly stages: readonly string[];
};

const sameList = (left: readonly string[], right: readonly string[]): boolean =>
  JSON.stringify(left) === JSON.stringify(right);

export const additiveViolations = (
  baseline: WireBaseline,
  additive: WireAdditive,
  shapes: readonly WireShape[],
  stages: readonly string[],
): string[] => {
  const failures: string[] = [];
  const byTag = new Map(shapes.map((shape) => [shape.tag, shape]));
  const additiveTags = new Set(additive.tags);

  for (const tag of baseline.tags) {
    const shape = byTag.get(tag);
    if (shape === undefined) {
      failures.push(`baseline tag ${tag} is missing from the schema`);
      continue;
    }
    if (!sameList(shape.fields, baseline.fields[tag] ?? [])) {
      failures.push(`baseline tag ${tag} changed its fields`);
    }
    if (!sameList(shape.optionalFields, baseline.optionalFields[tag] ?? [])) {
      failures.push(`baseline tag ${tag} changed its optional fields`);
    }
  }

  for (const shape of shapes) {
    if (baseline.tags.includes(shape.tag)) continue;
    if (!additiveTags.has(shape.tag)) {
      failures.push(`tag ${shape.tag} is not listed as additive`);
      continue;
    }
    const fields = additive.fields[shape.tag];
    if (fields === undefined || !sameList(shape.fields, fields)) {
      failures.push(`additive tag ${shape.tag} fields differ from the additive list`);
    }
    if (!sameList(shape.optionalFields, additive.optionalFields[shape.tag] ?? [])) {
      failures.push(`additive tag ${shape.tag} optional fields differ from the additive list`);
    }
  }

  for (const tag of additive.tags) {
    if (!byTag.has(tag)) failures.push(`additive tag ${tag} is missing from the schema`);
  }

  const expected = [...baseline.stages, ...additive.stages].toSorted();
  if (!sameList([...stages].toSorted(), expected)) {
    failures.push("stage set differs from the baseline plus the additive list");
  }

  return failures;
};
