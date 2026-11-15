import type { DataObject, DataValue } from '../files/equal.ts';
import type { FieldModel } from '../field-model.ts';
import type { FormManifest } from '../manifest/types.ts';
import { fieldModelIssues } from '../studio/field-checks.ts';
import {
  TEXTAREA_CAP,
  TEXT_CAP,
  answerRequired,
  fieldName,
  formControl,
  type FormControl,
} from './fields.ts';
import { HONEYPOT_FIELD, MANIFEST_FIELD, PAGE_FIELD, type FormIssue } from './types.ts';

/*
 * `readSubmission` (spec §7.6, step 2): what a post means, from the form's
 * field models alone, without Zod. The cloud runs it on every submission,
 * the script runs it before posting, and the dev API runs it in `astro dev`,
 * so all three refuse the same things in the same words.
 *
 * It turns the posted strings into values (numbers, yes or no, dates, lists
 * of choices), checks formats, lengths and choices, and drops anything the
 * form doesn't have. A refinement only the real schema knows never runs here;
 * the build warns about those.
 */

/** A post's fields: the browser's form data, or the same as a plain object. */
export type SubmissionInput =
  URLSearchParams | Readonly<Record<string, string | readonly string[] | undefined>>;

export type ReadSubmission = {
  values: DataObject;
  /** One per field at most, in the form's order. */
  issues: FormIssue[];
  /** Something was typed into the honeypot. */
  honeypot: boolean;
  /** `_vesper_page`, as posted. */
  page: string | null;
  /** `_vesper_manifest`, as posted. */
  manifest: string | null;
};

const EMAIL = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;
const DATETIME = /^(\d{4}-\d{2}-\d{2})T(([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?)$/;
// Control characters other than tab and line breaks never belong in an answer.
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

export function readSubmission(form: FormManifest, input: SubmissionInput): ReadSubmission {
  const all = (name: string): string[] => {
    if (input instanceof URLSearchParams) return input.getAll(name);
    const value = (input as Record<string, string | readonly string[] | undefined>)[name];
    if (value === undefined) return [];
    return typeof value === 'string' ? [value] : [...value];
  };
  const first = (name: string): string | undefined => all(name)[0];

  const issues: FormIssue[] = [];
  const values = readFields(form.fields ?? [], all, issues);
  for (const issue of fieldModelIssues(form.fields, values)) {
    const name = issue.path.filter((part): part is string => typeof part === 'string').join('.');
    issues.push({ field: name, message: issue.message });
  }
  return {
    values,
    issues: inFormOrder(form, issues),
    honeypot: (first(HONEYPOT_FIELD) ?? '').trim() !== '',
    page: first(PAGE_FIELD) ?? null,
    manifest: first(MANIFEST_FIELD) ?? null,
  };
}

function readFields(
  fields: readonly FieldModel[],
  all: (name: string) => string[],
  issues: FormIssue[],
): DataObject {
  const values: DataObject = {};
  for (const field of fields) {
    const key = field.path.at(-1);
    const control = formControl(field);
    if (key === undefined || control === null || field.hidden) continue;
    if (control === 'group') {
      const group = readFields(field.children ?? [], all, issues);
      // An optional group left empty is left out, so its own required fields don't count.
      if (field.required || Object.keys(group).length > 0) values[key] = group;
      continue;
    }
    const value = readValue(field, control, all(fieldName(field)), issues);
    if (value !== undefined) values[key] = value;
  }
  return values;
}

function readValue(
  field: FieldModel,
  control: FormControl,
  posted: string[],
  issues: FormIssue[],
): DataValue | undefined {
  const name = fieldName(field);
  const problem = (message: string) => {
    issues.push({ field: name, message });
  };
  if (control === 'checkbox') return posted.length > 0;
  if (control === 'checkboxes') {
    return [...new Set(posted.map((value) => value.trim()).filter((value) => value !== ''))];
  }

  const multiline = control === 'textarea';
  const raw = (posted[0] ?? '').replace(/\r\n?/g, '\n').replace(CONTROL, '');
  const text = multiline ? raw.trim() : raw.replace(/\s+/g, ' ').trim();
  if (text === '') return undefined;

  switch (control) {
    case 'number': {
      const number = Number(text);
      if (!Number.isFinite(number)) {
        problem('Enter a number.');
        return undefined;
      }
      return number;
    }
    case 'select':
    case 'radio':
      return text;
    case 'date':
      if (!realDate(text)) problem('Enter a date, such as 2026-11-15.');
      return text;
    case 'time':
      if (!TIME.test(text)) problem('Enter a time, such as 14:30.');
      return text;
    case 'datetime': {
      const match = DATETIME.exec(text);
      if (!match?.[1] || !realDate(match[1])) problem('Enter a date and a time.');
      return text;
    }
    default: {
      if (field.constraints?.max === undefined) {
        const cap = multiline ? TEXTAREA_CAP : TEXT_CAP;
        if (text.length > cap) problem(`Use at most ${String(cap)} characters.`);
      }
      if (control === 'email' && !EMAIL.test(text))
        problem('Enter an email address, such as name@example.com.');
      if (control === 'url' && !webAddress(text))
        problem('Enter a web address, such as https://example.com.');
      return text;
    }
  }
}

function realDate(text: string): boolean {
  const match = DATE.exec(text);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

function webAddress(text: string): boolean {
  try {
    const url = new URL(text);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

/**
 * One issue per field, the first found, in the order the form draws its
 * fields. A missing choice says "Choose one." rather than "This is required."
 */
function inFormOrder(form: FormManifest, issues: FormIssue[]): FormIssue[] {
  const order: { name: string; field: FieldModel }[] = [];
  const walk = (fields: readonly FieldModel[]) => {
    for (const field of fields) {
      if (formControl(field) === 'group') walk(field.children ?? []);
      else order.push({ name: fieldName(field), field });
    }
  };
  walk(form.fields ?? []);
  const result: FormIssue[] = [];
  for (const { name, field } of order) {
    const issue = issues.find((one) => one.field === name);
    if (!issue) continue;
    const control = formControl(field);
    const required = issue.message === 'This is required.';
    if (required && !answerRequired(field)) continue;
    if (required && (control === 'radio' || control === 'select'))
      result.push({ field: name, message: 'Choose one.' });
    else if (control === 'checkboxes' && issue.message.startsWith('Add at '))
      result.push({ field: name, message: issue.message.replace(/^Add/, 'Choose') });
    else result.push(issue);
  }
  return result;
}
