import type { Diagnostic, FieldModel } from '../field-model.ts';

/**
 * Widget resolution (spec §6.3). The first match wins:
 * 1. an explicit `.meta({ widget })`;
 * 2. a custom widget whose `match` returns true;
 * 3. base-type inference;
 * 4. the raw YAML field.
 *
 * An unknown widget name, a widget whose `accepts` rejects the field, or a
 * form-only widget outside a form, falls back to step 3 with a warning naming
 * the field and the widget. It never throws.
 *
 * Resolution runs when the manifest is built, in Node, where the functions in
 * `vesper.config.ts` can be called. The manifest stores the resolved name and
 * the inferred fallback, so the studio only looks components up by name.
 */

export type WidgetCheck = (field: FieldModel) => boolean;

/** What core needs to know about a custom widget. Its component is the studio's business. */
export type WidgetDefinition = { accepts?: WidgetCheck; match?: WidgetCheck };

const isString = (f: FieldModel) => f.kind === 'string';
const childKinds = (f: FieldModel) => f.children?.map((c) => c.kind) ?? [];
const child = (f: FieldModel, key: string) => f.children?.find((c) => c.path.at(-1) === key);

/** Built-in widgets and the fields each can edit (spec §6.2, §6.3.2). */
export const BUILTIN_WIDGETS: Record<string, WidgetCheck> = {
  text: isString,
  textarea: isString,
  markdown: isString,
  email: isString,
  url: isString,
  slug: isString,
  color: isString,
  file: isString,
  // A form's file field (spec §6.13): see FORM_WIDGETS.
  upload: (f) => f.kind === 'string' || f.kind === 'array',
  number: (f) => f.kind === 'number',
  switch: (f) => f.kind === 'boolean',
  date: (f) => f.kind === 'date' || isString(f),
  datetime: (f) => f.kind === 'date' || isString(f),
  select: (f) => f.kind === 'enum',
  radio: (f) => f.kind === 'enum',
  multiselect: (f) => f.kind === 'array' && childKinds(f)[0] === 'enum',
  tags: (f) => f.kind === 'array' && childKinds(f)[0] === 'string',
  group: (f) => f.kind === 'object',
  repeater: (f) => f.kind === 'array',
  reference: (f) => f.kind === 'reference',
  references: (f) => f.kind === 'array' && childKinds(f)[0] === 'reference',
  image: (f) =>
    f.kind === 'image' ||
    (f.kind === 'object' &&
      child(f, 'src')?.kind === 'image' &&
      child(f, 'alt')?.kind === 'string'),
  geo: (f) =>
    f.kind === 'object' && child(f, 'lat')?.kind === 'number' && child(f, 'lng')?.kind === 'number',
  raw: () => true,
};

/**
 * Widgets only a form's fields may name (spec §6.13). `<Form>` draws them on
 * the site, and the studio has no control for them, so a collection's field,
 * a Markdoc attribute or an MDX prop that names one gets the inferred widget,
 * with a warning, rather than a silent text field.
 */
const FORM_WIDGETS: ReadonlySet<string> = new Set(['upload']);

/** Spec §6.3 step 3: the control a field's type implies, with no hints. */
export function inferWidget(field: FieldModel): string {
  switch (field.kind) {
    case 'string':
      if (field.format === 'email') return 'email';
      if (field.format === 'url') return 'url';
      return 'text';
    case 'number':
      return 'number';
    case 'boolean':
      return 'switch';
    case 'date':
      return 'date';
    case 'enum':
      return (field.constraints?.options?.length ?? 0) <= 4 ? 'radio' : 'select';
    case 'array': {
      const item = field.children?.[0]?.kind;
      if (item === 'string') return 'tags';
      if (item === 'enum') return 'multiselect';
      if (item === 'reference') return 'references';
      return item === undefined || item === 'unknown' ? 'raw' : 'repeater';
    }
    case 'object':
      return 'group';
    case 'image':
      return 'image';
    case 'reference':
      return 'reference';
    case 'unknown':
      return 'raw';
  }
}

export type ResolveOptions = {
  /** Custom widgets from `vesper.config.ts`, in declaration order. */
  custom?: Record<string, WidgetDefinition>;
  collection?: string;
  /** The fields are a form's, which may name the form-only widgets. */
  form?: boolean;
};

function safeCheck(check: WidgetCheck | undefined, field: FieldModel): boolean | 'error' {
  if (!check) return true;
  try {
    return check(field);
  } catch {
    return 'error';
  }
}

/** Resolves the widget for a field and all its children. Returns new models; diagnostics are appended. */
export function resolveWidgets(
  fields: readonly FieldModel[],
  diagnostics: Diagnostic[],
  options: ResolveOptions = {},
): FieldModel[] {
  return fields.map((field) => resolveField(field, diagnostics, options));
}

function resolveField(
  field: FieldModel,
  diagnostics: Diagnostic[],
  options: ResolveOptions,
): FieldModel {
  const children = field.children
    ? resolveWidgets(field.children, diagnostics, options)
    : undefined;
  const resolved: FieldModel = { ...field, ...(children ? { children } : {}) };
  const inferred = inferWidget(resolved);
  resolved.inferredWidget = inferred;
  const custom = options.custom ?? {};
  const warn = (code: string, message: string) => {
    diagnostics.push({
      level: 'warning',
      code,
      message,
      path: field.path,
      ...(options.collection ? { collection: options.collection } : {}),
    });
  };
  const where = field.path.length > 0 ? field.path.join('.') : 'the root';

  // 1. An explicit widget.
  const requested = field.widget;
  if (requested !== undefined) {
    if (FORM_WIDGETS.has(requested) && options.form !== true && !Object.hasOwn(custom, requested)) {
      warn(
        'form-widget',
        `Field "${where}" asks for widget "${requested}", which only forms use: the studio has no control for it. Using "${inferred}" instead.`,
      );
      return { ...resolved, widget: inferred };
    }
    const accepts = Object.hasOwn(custom, requested)
      ? safeCheck(custom[requested]?.accepts, resolved)
      : Object.hasOwn(BUILTIN_WIDGETS, requested)
        ? safeCheck(BUILTIN_WIDGETS[requested], resolved)
        : null;
    if (accepts === true) return { ...resolved, widget: requested };
    if (accepts === null) {
      warn(
        'unknown-widget',
        `Field "${where}" asks for widget "${requested}", which doesn't exist. Using "${inferred}" instead.`,
      );
    } else {
      warn(
        'widget-rejected',
        `Widget "${requested}" can't edit field "${where}" (a ${field.kind}${accepts === 'error' ? '; its accepts() check threw' : ''}). Using "${inferred}" instead.`,
      );
    }
    return { ...resolved, widget: inferred };
  }

  // 2. A custom widget that claims the field.
  for (const [name, definition] of Object.entries(custom)) {
    if (!definition.match || safeCheck(definition.match, resolved) !== true) continue;
    const accepts = safeCheck(definition.accepts, resolved);
    if (accepts === true) return { ...resolved, widget: name };
    warn(
      'widget-rejected',
      `Widget "${name}" matched field "${where}" but its accepts() rejected it. Skipping it.`,
    );
  }

  // 3–4. Inference, which falls back to the raw field for unknown kinds.
  return { ...resolved, widget: inferred };
}
