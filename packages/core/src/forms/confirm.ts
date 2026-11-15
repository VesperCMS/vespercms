import type { DataObject } from '../files/equal.ts';
import type { FieldModel } from '../field-model.ts';
import type { FormManifest } from '../manifest/types.ts';
import { fieldName, formLeaves, optionLabel } from './fields.ts';
import { valueAt } from './route.ts';
import type { FormTemplate } from './types.ts';

/*
 * Confirmation emails (D20): the template is the site owner's, and it can
 * repeat back only fields that are safe to echo, so a form can't be made to
 * send a stranger words of the sender's choosing. By default those are name
 * fields (DECISIONS.md, "Phase 6a's calls", call 8): `autocomplete` says the
 * field is a name. Any other field needs `safeToEcho: true`; a name field
 * can opt out with `safeToEcho: false`.
 */

const NAME_TOKENS: ReadonlySet<string> = new Set([
  'name',
  'honorific-prefix',
  'given-name',
  'additional-name',
  'family-name',
  'honorific-suffix',
  'nickname',
]);

const TOKEN = /\{([A-Za-z_][\w.-]*)\}/g;

export function safeToEcho(field: FieldModel): boolean {
  if (field.safeToEcho !== undefined) return field.safeToEcho;
  // `autocomplete` can carry a section and a purpose first ("section-a shipping name").
  const token = field.autocomplete?.trim().split(/\s+/).at(-1)?.toLowerCase();
  return token !== undefined && NAME_TOKENS.has(token);
}

/** The fields a template may name, by the token that names them. */
export function echoableFields(form: FormManifest): { token: string; field: FieldModel }[] {
  return formLeaves(form.fields)
    .filter(safeToEcho)
    .map((field) => ({ token: fieldName(field), field }));
}

/** Why a template can't be saved, one sentence per token it can't use. */
export function templateIssues(template: FormTemplate, form: FormManifest): string[] {
  const allowed = new Set(echoableFields(form).map((one) => one.token));
  const known = new Set(formLeaves(form.fields).map(fieldName));
  const tokens = new Set(
    [...`${template.subject}\n${template.body}`.matchAll(TOKEN)].map((match) => match[1] ?? ''),
  );
  return [...tokens].flatMap((token) => {
    if (allowed.has(token)) return [];
    return known.has(token)
      ? [`{${token}} can't be used: only fields that are safe to echo can be repeated back.`]
      : [`{${token}} isn't a field of this form.`];
  });
}

/**
 * The template with each token filled. A token for a field that isn't safe
 * to echo, or isn't the form's (it changed since the template was saved),
 * is left out. The subject stays on one line.
 */
export function mergeConfirmation(
  template: FormTemplate,
  form: FormManifest,
  values: DataObject,
): { subject: string; text: string } {
  const fields = new Map(echoableFields(form).map((one) => [one.token, one.field]));
  const fill = (text: string, oneLine: boolean) =>
    text.replace(TOKEN, (_whole, token: string) => {
      const field = fields.get(token);
      if (!field) return '';
      const answer = answerText(field, valueAt(values, token));
      return oneLine ? answer.replace(/\s+/g, ' ').trim() : answer;
    });
  return {
    subject: fill(template.subject, true).replace(/\s+/g, ' ').trim(),
    text: fill(template.body, false),
  };
}

/** An answer as words: a choice's label, a list joined with commas, yes or no. */
export function answerText(field: FieldModel, value: unknown): string {
  if (value === undefined || value === null) return '';
  if (Array.isArray(value)) return value.map((one) => answerText(field, one)).join(', ');
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'string') return field.kind === 'string' ? value : optionLabel(field, value);
  if (typeof value === 'number') return String(value);
  return '';
}
