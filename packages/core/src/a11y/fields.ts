import type { FieldModel } from '../field-model.ts';
import { childrenFor } from '../schema/variants.ts';
import { altProblems, checkBody, isSitePdf } from './body.ts';
import { CONTRAST_MINIMUM, contrastRatio, formatRatio, isContrastUse } from './contrast.ts';
import { A11Y_RULES, type A11yRuleId } from './rules.ts';
import { fileNameOf, quoted } from './text.ts';
import type { A11yBackground, A11yNote, PdfFacts, PdfTarget } from './types.ts';

/*
 * Layer-1 checks over an entry's fields (spec §6.18): image alt text, text
 * colours against the site's backgrounds, compact Markdown, and the PDFs
 * file fields point at (read later, by the studio). Notes point at the
 * field's value path, so the studio shows each one under its field.
 */

export type FieldCheckOptions = { backgrounds?: readonly A11yBackground[] };

export type FieldCheck = { notes: A11yNote[]; pdfs: PdfTarget[] };

type Path = (string | number)[];

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Notes for every field of an entry, in form order, and the PDFs its file fields point at. */
export function checkFields(
  fields: readonly FieldModel[] | null,
  values: unknown,
  options: FieldCheckOptions = {},
): FieldCheck {
  const notes: A11yNote[] = [];
  const pdfs: PdfTarget[] = [];
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
      case 'file':
        if (typeof value === 'string' && isSitePdf(value))
          pdfs.push({ href: value, target: { kind: 'field', path } });
        return;
      case 'markdown': {
        if (typeof value !== 'string') return;
        const found = checkBody(value, 'md', { headings: false });
        for (const n of found.notes) notes.push({ ...n, target: { kind: 'field', path } });
        for (const p of found.pdfs) pdfs.push({ ...p, target: { kind: 'field', path } });
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
  return { notes, pdfs };
}

/** Notes for one PDF, from what the studio read in it. */
export function pdfNotes(pdf: PdfTarget, facts: PdfFacts): A11yNote[] {
  const subject = pdf.subject ?? `PDF ${quoted(fileNameOf(pdf.href))}`;
  const found: [A11yRuleId, string][] = [];
  if (!facts.tagged)
    found.push([
      'pdf-untagged',
      'This PDF isn’t tagged, so screen readers can’t read its structure. Consider an HTML page instead, or tag the PDF.',
    ]);
  if (!facts.title?.trim()) found.push(['pdf-no-title', 'This PDF has no document title.']);
  if (!facts.language?.trim())
    found.push(['pdf-no-language', 'This PDF doesn’t say what language it’s in.']);
  return found.map(([rule, message]) => ({
    rule,
    message,
    why: A11Y_RULES[rule].why,
    target: pdf.target,
    subject,
  }));
}
