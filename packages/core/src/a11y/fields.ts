import type { FieldModel } from '../field-model.ts';
import { childrenFor } from '../schema/variants.ts';
import { altProblems, checkBody } from './body.ts';
import { CONTRAST_MINIMUM, contrastRatio, formatRatio, isContrastUse } from './contrast.ts';
import { A11Y_RULES, type A11yRuleId } from './rules.ts';
import type { A11yBackground, A11yNote } from './types.ts';

/*
 * Layer-1 checks over an entry's fields (spec §6.18): image alt text, text
 * colours against the site's backgrounds, and compact Markdown. Notes point
 * at the field's value path, so the studio shows each one under its field.
 * Files (PDFs among them) aren't checked: what's inside one is its author's
 * (DECISIONS.md, "Vesper doesn't check PDFs").
 */

export type FieldCheckOptions = { backgrounds?: readonly A11yBackground[] };

export type FieldCheck = { notes: A11yNote[] };

type Path = (string | number)[];

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Notes for every field of an entry, in form order. */
export function checkFields(
  fields: readonly FieldModel[] | null,
  values: unknown,
  options: FieldCheckOptions = {},
): FieldCheck {
  const notes: A11yNote[] = [];
  const note = (rule: A11yRuleId, message: string, path: Path, subject?: string) => {
    notes.push({
      rule,
      message,
      why: A11Y_RULES[rule].why,
      target: { kind: 'field', path },
      ...(subject ? { subject } : {}),
    });
  };

  const visit = (field: FieldModel, value: unknown, path: Path): void => {
    if (value === undefined || value === null) return;
    switch (field.widget) {
      case 'image': {
        if (!isObject(value)) return;
        const src = value.src;
        if (typeof src !== 'string' || src === '') return;
        const alt = typeof value.alt === 'string' ? value.alt : '';
        if (value.decorative === true) return;
        // An image field's empty alt is missing unless the field says decorative.
        const problems = altProblems(alt.trim() === '' ? null : alt);
        for (const [rule, message] of problems) note(rule, message, [...path, 'alt']);
        return;
      }
      case 'color': {
        const use = field.widgetOptions?.contrast;
        if (typeof value !== 'string' || !isContrastUse(use)) return;
        const minimum = CONTRAST_MINIMUM[use];
        for (const background of options.backgrounds ?? []) {
          const ratio = contrastRatio(value, background.color);
          if (ratio !== null && ratio < minimum)
            note(
              'color-contrast',
              `Contrast ${formatRatio(ratio)} against ${background.name} is below ${String(minimum)}:1.`,
              path,
            );
        }
        return;
      }
      case 'markdown': {
        if (typeof value !== 'string') return;
        const found = checkBody(value, 'md', { headings: false });
        for (const n of found.notes) notes.push({ ...n, target: { kind: 'field', path } });
        return;
      }
      default:
        break;
    }
    if ((field.kind === 'object' || field.kind === 'union') && isObject(value)) {
      for (const child of childrenFor(field, value)) {
        const key = child.path.at(-1);
        if (key !== undefined) visit(child, value[key], [...path, key]);
      }
    } else if (field.kind === 'array' && Array.isArray(value)) {
      const item = field.children?.[0];
      if (item)
        value.forEach((entry, index) => {
          visit(item, entry, [...path, index]);
        });
    }
  };

  for (const field of fields ?? []) {
    const key = field.path.at(-1);
    if (key !== undefined && isObject(values)) visit(field, values[key], [key]);
  }
  return { notes };
}
