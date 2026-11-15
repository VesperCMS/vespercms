import type { DataObject } from '../files/equal.ts';
import type { FieldModel } from '../field-model.ts';
import type { FormManifest } from '../manifest/types.ts';
import {
  TEXTAREA_CAP,
  TEXT_CAP,
  answerRequired,
  choicesOf,
  fieldName,
  formControl,
} from './fields.ts';
import { valueAt } from './route.ts';
import {
  FORM_REFUSALS,
  HONEYPOT_FIELD,
  MANIFEST_FIELD,
  PAGE_FIELD,
  type FormIssue,
} from './types.ts';

/*
 * `formHtml` (spec §6.13): the one renderer of a form. `<Form>` calls it at
 * build, and the cloud calls it for the page that answers a failed post
 * without JavaScript, so both are the same markup:
 * - a real <label> on every field, with "(required)" in its text;
 * - help and errors joined through aria-describedby, aria-invalid on a field
 *   that failed, and an error summary whose links go to each field;
 * - fieldset and legend for groups and for radios and checkboxes;
 * - autocomplete from the meta, and the native required, type, length and
 *   pattern, so a browser without the script still checks the easy things;
 * - a honeypot hidden from eyes and assistive technology alike.
 */

export type FormStrings = {
  required: string;
  summaryTitle: string;
  submit: string;
  sending: string;
  honeypot: string;
  chooseOne: string;
  sent: string;
  notConnected: string;
  paused: string;
  failed: string;
};

export const FORM_STRINGS: FormStrings = {
  required: '(required)',
  summaryTitle: 'There is a problem',
  submit: 'Send',
  sending: 'Sending…',
  honeypot: 'Leave this empty',
  chooseOne: 'Choose one',
  sent: 'Thanks. Your message was sent.',
  notConnected: 'This form isn’t connected yet.',
  paused: FORM_REFUSALS.paused,
  failed: FORM_REFUSALS.unavailable,
};

export type FormHtmlOptions = {
  /** Where the form posts, or null when the site isn't connected to the cloud. */
  action: string | null;
  /** The page's address, posted as `_vesper_page` so the cloud can send the browser back. */
  page?: string;
  /** The hash of the manifest the page was built with. */
  manifest?: string;
  values?: DataObject;
  issues?: FormIssue[];
  /** Draws the message shown once the form is sent; the cloud's page has none. */
  sentMessage?: boolean;
  /** JSON for the enhancement script. */
  config?: string;
  /** A paused form says so in place of its fields. */
  paused?: boolean;
  strings?: Partial<FormStrings>;
  /** For a second copy of one form on a page. */
  id?: string;
};

export const formId = (name: string): string => `vesper-form-${name}`;
export const fieldId = (prefix: string, name: string): string =>
  `${prefix}-${name.replace(/[^\w-]/g, '-')}`;

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

type Context = {
  prefix: string;
  values: DataObject;
  issues: Map<string, string>;
  strings: FormStrings;
};

export function formHtml(form: FormManifest, options: FormHtmlOptions): string {
  const strings = { ...FORM_STRINGS, ...options.strings };
  const prefix = options.id ?? formId(form.name);
  const wrapper = (state: string, inner: string) =>
    `<div class="vesper-form" id="${escapeHtml(prefix)}" data-vesper-form="${escapeHtml(form.name)}" data-vesper-form-state="${state}">${inner}</div>`;
  if (options.action === null)
    return wrapper(
      'not-connected',
      `<p class="vesper-form-note">${escapeHtml(strings.notConnected)}</p>`,
    );
  if (options.paused)
    return wrapper('paused', `<p class="vesper-form-note">${escapeHtml(strings.paused)}</p>`);

  const issues = options.issues ?? [];
  const context: Context = {
    prefix,
    values: options.values ?? {},
    issues: new Map(issues.map((issue) => [issue.field, issue.message])),
    strings,
  };
  const success =
    typeof form.options.successMessage === 'string' && form.options.successMessage.trim() !== ''
      ? form.options.successMessage
      : strings.sent;
  const submit =
    typeof form.options.submitLabel === 'string' && form.options.submitLabel.trim() !== ''
      ? form.options.submitLabel
      : strings.submit;
  const fieldsHtml = (form.fields ?? []).map((field) => fieldHtml(field, context)).join('');
  const hidden = [
    options.page === undefined ? '' : hiddenInput(PAGE_FIELD, options.page),
    options.manifest === undefined ? '' : hiddenInput(MANIFEST_FIELD, options.manifest),
  ].join('');
  const config =
    options.config === undefined ? '' : ` data-vesper-form-config="${escapeHtml(options.config)}"`;

  return wrapper(
    'open',
    [
      options.sentMessage
        ? `<div class="vesper-form-sent" id="${escapeHtml(prefix)}-sent" tabindex="-1"><p>${escapeHtml(success)}</p></div>`
        : '',
      `<form class="vesper-form-form" method="post" action="${escapeHtml(options.action)}" accept-charset="UTF-8"${config}>`,
      summaryHtml(form, issues, context),
      fieldsHtml,
      `<div class="vesper-form-hp" aria-hidden="true"><label for="${escapeHtml(prefix)}-hp">${escapeHtml(strings.honeypot)}</label><input id="${escapeHtml(prefix)}-hp" name="${HONEYPOT_FIELD}" type="text" tabindex="-1" autocomplete="off"></div>`,
      hidden,
      `<p class="vesper-form-status" role="status" data-vesper-form-status></p>`,
      `<button type="submit" class="vesper-form-submit">${escapeHtml(submit)}</button>`,
      '</form>',
    ].join(''),
  );
}

/** The error summary, always present so the script can fill it; hidden while there's nothing in it. */
function summaryHtml(form: FormManifest, issues: FormIssue[], context: Context): string {
  const prefix = escapeHtml(context.prefix);
  const items = issues
    .map((issue) => {
      const field = findField(form.fields ?? [], issue.field);
      const label = field ? field.label : issue.field;
      return `<li><a href="#${escapeHtml(targetId(field, issue.field, context))}">${escapeHtml(label)}: ${escapeHtml(issue.message)}</a></li>`;
    })
    .join('');
  return `<div class="vesper-form-summary" id="${prefix}-summary" tabindex="-1" aria-labelledby="${prefix}-summary-title" data-vesper-form-summary${issues.length === 0 ? ' hidden' : ''}><h2 id="${prefix}-summary-title">${escapeHtml(context.strings.summaryTitle)}</h2><ul>${items}</ul></div>`;
}

/** Where an error's link goes: the field's control, or a group's first choice. */
export function targetId(
  field: FieldModel | null,
  name: string,
  context: { prefix: string },
): string {
  const id = fieldId(context.prefix, name);
  if (!field) return id;
  const control = formControl(field);
  return control === 'radio' || control === 'checkboxes' ? `${id}-0` : id;
}

function findField(fields: readonly FieldModel[], name: string): FieldModel | null {
  for (const field of fields) {
    if (fieldName(field) === name) return field;
    const inner = findField(field.children && field.kind === 'object' ? field.children : [], name);
    if (inner) return inner;
  }
  return null;
}

function fieldHtml(field: FieldModel, context: Context): string {
  const control = formControl(field);
  if (control === null || field.hidden) return '';
  const name = fieldName(field);
  const id = fieldId(context.prefix, name);
  const value = valueAt(context.values, name);
  const error = context.issues.get(name);
  const required = answerRequired(field);
  const mark = required
    ? ` <span class="vesper-form-required">${escapeHtml(context.strings.required)}</span>`
    : '';
  const help = field.description
    ? `<p class="vesper-form-help" id="${id}-help">${escapeHtml(field.description)}</p>`
    : '';
  const errorHtml = error
    ? `<p class="vesper-form-error" id="${id}-error">${escapeHtml(error)}</p>`
    : '';
  const described = [field.description ? `${id}-help` : '', error ? `${id}-error` : '']
    .filter(Boolean)
    .join(' ');
  const describedBy = described ? ` aria-describedby="${described}"` : '';
  const invalid = error ? ' aria-invalid="true"' : '';
  const errorClass = error ? ' vesper-form-field-error' : '';

  if (control === 'group') {
    const inner = (field.children ?? []).map((child) => fieldHtml(child, context)).join('');
    return `<fieldset class="vesper-form-group"${describedBy}><legend>${escapeHtml(field.label)}</legend>${help}${inner}</fieldset>`;
  }

  if (control === 'radio' || control === 'checkboxes') {
    const type = control === 'radio' ? 'radio' : 'checkbox';
    const chosen = new Set(
      (Array.isArray(value) ? value : value === undefined ? [] : [value]).map(String),
    );
    const choices = choicesOf(field)
      .map((choice, i) => {
        const checked = chosen.has(choice.value) ? ' checked' : '';
        const req = control === 'radio' && required ? ' required' : '';
        return `<div class="vesper-form-choice"><input id="${id}-${String(i)}" name="${escapeHtml(name)}" type="${type}" value="${escapeHtml(choice.value)}"${checked}${req}><label for="${id}-${String(i)}">${escapeHtml(choice.label)}</label></div>`;
      })
      .join('');
    return `<fieldset class="vesper-form-field vesper-form-choices${errorClass}" data-vesper-field="${escapeHtml(name)}"${describedBy}><legend>${escapeHtml(field.label)}${mark}</legend>${help}${errorHtml}${choices}</fieldset>`;
  }

  if (control === 'checkbox') {
    const checked = value === true ? ' checked' : '';
    return `<div class="vesper-form-field vesper-form-check${errorClass}" data-vesper-field="${escapeHtml(name)}"><input id="${id}" name="${escapeHtml(name)}" type="checkbox" value="yes"${checked}${describedBy}><label for="${id}">${escapeHtml(field.label)}</label>${help}${errorHtml}</div>`;
  }

  const label = `<label for="${id}">${escapeHtml(field.label)}${mark}</label>`;
  const common = `id="${id}" name="${escapeHtml(name)}"${required ? ' required' : ''}${describedBy}${invalid}${field.autocomplete ? ` autocomplete="${escapeHtml(field.autocomplete)}"` : ''}${field.readOnly ? ' readonly' : ''}`;
  const text = typeof value === 'string' || typeof value === 'number' ? String(value) : '';
  let input: string;
  if (control === 'select') {
    const options = choicesOf(field)
      .map(
        (choice) =>
          `<option value="${escapeHtml(choice.value)}"${choice.value === text ? ' selected' : ''}>${escapeHtml(choice.label)}</option>`,
      )
      .join('');
    input = `<select ${common}><option value="">${escapeHtml(context.strings.chooseOne)}</option>${options}</select>`;
  } else if (control === 'textarea') {
    input = `<textarea ${common}${lengths(field, TEXTAREA_CAP)} rows="6">${escapeHtml(text)}</textarea>`;
  } else {
    const type = {
      text: 'text',
      email: 'email',
      url: 'url',
      tel: 'tel',
      number: 'number',
      date: 'date',
      time: 'time',
      datetime: 'datetime-local',
    }[control];
    const extra =
      control === 'number'
        ? numberLimits(field)
        : control === 'text' || control === 'email' || control === 'url' || control === 'tel'
          ? `${lengths(field, TEXT_CAP)}${pattern(field)}${field.placeholder ? ` placeholder="${escapeHtml(field.placeholder)}"` : ''}`
          : '';
    input = `<input ${common} type="${type}"${extra} value="${escapeHtml(text)}">`;
  }
  return `<div class="vesper-form-field${errorClass}" data-vesper-field="${escapeHtml(name)}">${label}${help}${errorHtml}${input}</div>`;
}

function lengths(field: FieldModel, cap: number): string {
  const { min, max } = field.constraints ?? {};
  return `${min !== undefined && min > 0 ? ` minlength="${String(min)}"` : ''} maxlength="${String(max ?? cap)}"`;
}

function numberLimits(field: FieldModel): string {
  const { min, max, step, integer } = field.constraints ?? {};
  return [
    min !== undefined ? ` min="${String(min)}"` : '',
    max !== undefined ? ` max="${String(max)}"` : '',
    step !== undefined ? ` step="${String(step)}"` : integer ? ' step="1"' : ' step="any"',
  ].join('');
}

/** A pattern the browser can check: one with flags can't be written as an attribute. */
function pattern(field: FieldModel): string {
  const { pattern: source, patternFlags } = field.constraints ?? {};
  return source && !patternFlags ? ` pattern="${escapeHtml(source)}"` : '';
}

function hiddenInput(name: string, value: string): string {
  return `<input type="hidden" name="${name}" value="${escapeHtml(value)}">`;
}
