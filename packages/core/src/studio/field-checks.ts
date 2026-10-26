import { isPlainObject, type DataObject, type DataValue } from '../files/equal.ts';
import type { FieldModel } from '../field-model.ts';
import { childrenFor, variantFor } from '../schema/variants.ts';
import type { FieldIssue } from './protocol.ts';

/*
 * Checks from the field model alone: GitHub mode's fallback when the site's
 * own schemas couldn't be built for the browser (DECISIONS.md, "GitHub mode
 * validates with the real schemas"). It's deliberately narrow: required
 * values, choices, numbers and patterns. Refinements and transforms only the
 * real schema knows are left to the site's build, so this never refuses a
 * value the site would accept.
 */

export function fieldModelIssues(
  fields: readonly FieldModel[] | null,
  data: DataObject,
): FieldIssue[] {
  const issues: FieldIssue[] = [];
  for (const field of fields ?? [])
    check(field, data[field.path.at(-1) ?? ''], [field.path.at(-1) ?? ''], issues);
  return issues;
}

function check(
  field: FieldModel,
  value: DataValue,
  at: (string | number)[],
  issues: FieldIssue[],
): void {
  // An empty string is a value: z.string() accepts it unless the schema says otherwise.
  const empty = value === undefined || value === null;
  if (empty) {
    const allowed =
      value === null ? field.nullable === true : !field.required || field.default !== undefined;
    if (!allowed && field.kind !== 'unknown')
      issues.push({ path: at, message: 'This is required.' });
    return;
  }
  const constraints = field.constraints ?? {};
  switch (field.kind) {
    case 'string': {
      if (typeof value !== 'string') return;
      if (constraints.min !== undefined && value.length < constraints.min)
        issues.push({ path: at, message: `Use at least ${String(constraints.min)} characters.` });
      if (constraints.max !== undefined && value.length > constraints.max)
        issues.push({ path: at, message: `Use at most ${String(constraints.max)} characters.` });
      if (constraints.pattern !== undefined) {
        let pattern: RegExp | null = null;
        try {
          pattern = new RegExp(constraints.pattern, constraints.patternFlags);
        } catch {
          // A pattern the browser can't compile is left to the site's build.
        }
        if (pattern && !pattern.test(value))
          issues.push({ path: at, message: 'This isn’t in the form the site expects.' });
      }
      return;
    }
    case 'number': {
      if (typeof value !== 'number' || Number.isNaN(value)) {
        issues.push({ path: at, message: 'Enter a number.' });
        return;
      }
      if (constraints.integer && !Number.isInteger(value))
        issues.push({ path: at, message: 'Enter a whole number.' });
      const minOk =
        constraints.min === undefined ||
        (constraints.minInclusive === false ? value > constraints.min : value >= constraints.min);
      const maxOk =
        constraints.max === undefined ||
        (constraints.maxInclusive === false ? value < constraints.max : value <= constraints.max);
      if (!minOk) issues.push({ path: at, message: `Enter ${String(constraints.min)} or more.` });
      if (!maxOk) issues.push({ path: at, message: `Enter ${String(constraints.max)} or less.` });
      return;
    }
    case 'boolean':
      if (typeof value !== 'boolean') issues.push({ path: at, message: 'Choose yes or no.' });
      return;
    case 'enum': {
      const options = constraints.options ?? [];
      if (options.length > 0 && !options.some((option) => option.value === value)) {
        const labels = options.map((option) => option.label);
        issues.push({ path: at, message: `Choose one of ${labels.join(', ')}.` });
      }
      return;
    }
    case 'object':
    case 'union':
      if (!isPlainObject(value)) return;
      if (field.kind === 'union' && !variantFor(field, value)) {
        issues.push({
          path: [...at, field.discriminator ?? ''],
          message: 'Choose one of the kinds the site has.',
        });
        return;
      }
      for (const child of childrenFor(field, value)) {
        const key = child.path.at(-1) ?? '';
        check(child, value[key], [...at, key], issues);
      }
      return;
    case 'array': {
      if (!Array.isArray(value)) return;
      const item = field.children?.[0];
      if (constraints.min !== undefined && value.length < constraints.min)
        issues.push({ path: at, message: `Add at least ${String(constraints.min)}.` });
      if (constraints.max !== undefined && value.length > constraints.max)
        issues.push({ path: at, message: `Add at most ${String(constraints.max)}.` });
      if (item) {
        value.forEach((one, i) => {
          check(item, one, [...at, i], issues);
        });
      }
      return;
    }
    default:
      // Dates, images, references and raw fields: their forms are the real schema's to judge.
      return;
  }
}
