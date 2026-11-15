import type { Diagnostic, FieldModel } from '../field-model.ts';
import type { FormManifest } from '../manifest/types.ts';
import { isZodLike } from '../schema/walk.ts';
import { confirmationField, fieldName, formControl, formField } from './fields.ts';
import { RESERVED_FIELD_NAMES } from './types.ts';

/*
 * What the build says about a form (spec §6.13). The cloud checks a
 * submission against the form's field models only, so anything the models
 * can't carry is said here, where the developer sees it, rather than found
 * by a visitor.
 */

export function formDiagnostics(form: FormManifest, schema: unknown): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const collection = `form:${form.name}`;
  const say = (level: Diagnostic['level'], code: string, message: string, path?: string[]) => {
    diagnostics.push({ level, code, message, collection, ...(path ? { path } : {}) });
  };

  if (!/^[a-z][\w-]*$/i.test(form.name)) {
    say(
      'error',
      'form-name',
      `Form "${form.name}" needs a name of letters, digits, - and _, starting with a letter: it's part of the form's address.`,
    );
  }
  if (form.name === 'config') {
    say(
      'error',
      'form-name',
      'A form can’t be named "config": the cloud answers that address with the forms’ settings.',
    );
  }
  if (form.fields === null) {
    say('error', 'form-schema', `Form "${form.name}" needs a z.object() schema.`);
    return diagnostics;
  }

  const visit = (fields: readonly FieldModel[]) => {
    for (const field of fields) {
      const name = fieldName(field);
      if (
        RESERVED_FIELD_NAMES.includes(field.path.at(-1) ?? '') ||
        (field.path.at(-1) ?? '').startsWith('_vesper')
      ) {
        say(
          'error',
          'form-reserved-name',
          `Form "${form.name}": "${name}" is a name <Form> keeps for itself. Rename the field.`,
          field.path,
        );
        continue;
      }
      if (field.widget === 'upload' || field.inferredWidget === 'upload') {
        say(
          'error',
          'form-upload',
          `Form "${form.name}": "${name}" is a file upload, which arrives in Phase 6b. Leave it out until then.`,
          field.path,
        );
        continue;
      }
      const control = formControl(field);
      if (control === null) {
        say(
          'error',
          'form-field-kind',
          `Form "${form.name}": <Form> can't draw "${name}" (a ${field.kind}${field.kind === 'array' ? ' of anything but choices' : ''}). A form takes text, numbers, dates, choices, lists of choices, yes or no, and groups of these.`,
          field.path,
        );
        continue;
      }
      if (control === 'group') visit(field.children ?? []);
    }
  };
  visit(form.fields);

  const emailField = confirmationField(form);
  if (form.options.confirmation !== undefined && emailField === null) {
    say(
      'error',
      'form-confirmation',
      `Form "${form.name}": confirmation needs { emailField: '…' }, the field the confirmation goes to.`,
    );
  } else if (emailField !== null) {
    const field = formField(form, emailField);
    if (!field || formControl(field) !== 'email') {
      say(
        'error',
        'form-confirmation',
        `Form "${form.name}": confirmation.emailField "${emailField}" must name an email field (z.email()).`,
      );
    }
  }
  for (const key of ['title', 'successMessage', 'submitLabel'] as const) {
    const value = form.options[key];
    if (value !== undefined && typeof value !== 'string') {
      say('error', 'form-options', `Form "${form.name}": ${key} must be text.`);
    }
  }

  for (const path of refinedPaths(schema, [])) {
    say(
      'warning',
      'form-refinement',
      `Form "${form.name}": ${path.length ? `"${path.join('.')}"` : 'the form'} has a refinement or a custom check. The cloud checks submissions against the field's type, length, format and choices only, so it never runs.`,
      path,
    );
  }
  return diagnostics;
}

const WRAPPERS = new Set([
  'optional',
  'nullable',
  'default',
  'prefault',
  'nonoptional',
  'readonly',
  'catch',
]);

/** Where a Zod schema has a `.refine()` or `.superRefine()`, read structurally as core reads every schema. */
function refinedPaths(schema: unknown, path: string[]): string[][] {
  if (!isZodLike(schema)) return [];
  const def = schema._zod.def as {
    type: string;
    checks?: unknown[];
    innerType?: unknown;
    shape?: unknown;
    element?: unknown;
  };
  const own = (def.checks ?? []).some(
    (check) =>
      (check as { _zod?: { def?: { check?: unknown } } } | null)?._zod?.def?.check === 'custom',
  );
  const found = own ? [path] : [];
  if (WRAPPERS.has(def.type)) return [...found, ...refinedPaths(def.innerType, path)];
  if (def.type === 'object' && typeof def.shape === 'object' && def.shape !== null) {
    return [
      ...found,
      ...Object.entries(def.shape as Record<string, unknown>).flatMap(([key, child]) =>
        refinedPaths(child, [...path, key]),
      ),
    ];
  }
  if (def.type === 'array') return [...found, ...refinedPaths(def.element, path)];
  return found;
}
