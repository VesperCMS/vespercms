import type { FieldModel } from '../field-model.ts';
import type { FormManifest } from '../manifest/types.ts';

/*
 * A form's fields as `<Form>` draws them. A field's name is its path joined
 * with dots (`address.city`), which is what the browser posts and what
 * routing rules and issues name.
 */

/** What `<Form>` draws for a field, or null for one it can't (the build says so). */
export type FormControl =
  | 'text'
  | 'textarea'
  | 'email'
  | 'url'
  | 'tel'
  | 'number'
  | 'date'
  | 'time'
  | 'datetime'
  | 'select'
  | 'radio'
  | 'checkbox'
  | 'checkboxes'
  | 'group';

/** One line of text at most this long, and a textarea at most this, when the schema sets no `max`. */
export const TEXT_CAP = 500;
export const TEXTAREA_CAP = 10_000;

export const fieldName = (field: FieldModel): string => field.path.join('.');

export function formControl(field: FieldModel): FormControl | null {
  const widget = field.widget ?? field.inferredWidget;
  switch (field.kind) {
    case 'string':
      if (widget === 'textarea' || widget === 'markdown') return 'textarea';
      if (widget === 'email' || field.format === 'email') return 'email';
      if (widget === 'url' || field.format === 'url') return 'url';
      if (widget === 'tel') return 'tel';
      if (widget === 'date') return 'date';
      if (widget === 'time') return 'time';
      if (widget === 'datetime') return 'datetime';
      if (widget === 'upload') return null;
      return 'text';
    case 'number':
      return 'number';
    case 'date':
      return widget === 'datetime' ? 'datetime' : 'date';
    case 'boolean':
      return 'checkbox';
    case 'enum':
      return widget === 'select' ? 'select' : 'radio';
    case 'array':
      return field.children?.[0]?.kind === 'enum' && widget !== 'upload' ? 'checkboxes' : null;
    case 'object':
      return 'group';
    default:
      return null;
  }
}

/** Every field with a value of its own (not a group), depth first, in the form's order. */
export function formLeaves(fields: readonly FieldModel[] | null): FieldModel[] {
  return (fields ?? []).flatMap((field) =>
    formControl(field) === 'group' ? formLeaves(field.children ?? []) : [field],
  );
}

/** The field a name points at, groups included. */
export function formField(form: FormManifest, name: string): FieldModel | null {
  const find = (fields: readonly FieldModel[]): FieldModel | null => {
    for (const field of fields) {
      if (fieldName(field) === name) return field;
      if (field.kind === 'object') {
        const inner = find(field.children ?? []);
        if (inner) return inner;
      }
    }
    return null;
  };
  return find(form.fields ?? []);
}

/** A choice's label, from the field's options. */
export function optionLabel(field: FieldModel, value: string): string {
  const options = field.kind === 'array' ? field.children?.[0]?.constraints?.options : undefined;
  return (
    (options ?? field.constraints?.options)?.find((option) => option.value === value)?.label ??
    value
  );
}

/** The options of a choice, or of a list of choices. */
export function choicesOf(field: FieldModel): { value: string; label: string }[] {
  const source = field.kind === 'array' ? field.children?.[0] : field;
  return source?.constraints?.options ?? [];
}

/** A required field must be answered: no default, and not a yes-or-no, which is always one or the other. */
export function answerRequired(field: FieldModel): boolean {
  if (field.kind === 'boolean') return false;
  if (field.kind === 'array') return (field.constraints?.min ?? 0) > 0;
  return field.required && field.default === undefined;
}

/** The form's title: `options.title`, or its key. */
export function formTitle(form: FormManifest): string {
  const title = form.options.title;
  return typeof title === 'string' && title.trim() !== '' ? title : form.name;
}

/** The field named by `confirmation.emailField`, when it's there. */
export function confirmationField(form: FormManifest): string | null {
  const confirmation = form.options.confirmation;
  if (typeof confirmation !== 'object' || confirmation === null) return null;
  const field = (confirmation as { emailField?: unknown }).emailField;
  return typeof field === 'string' ? field : null;
}
