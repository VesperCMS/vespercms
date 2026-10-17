import type { Diagnostic, FieldModel } from '../field-model.ts';
import { humanize } from '../schema/humanize.ts';
import type {
  MarkdocAttributeManifest,
  MarkdocManifest,
  MarkdocMatches,
  MarkdocTagHint,
  MarkdocTagManifest,
  MarkdocVariables,
} from './types.ts';

/*
 * Reads the schema parts of a site's Markdoc config, already merged the way
 * @astrojs/markdoc merges it, into plain JSON for the manifest. Structural:
 * types are recognized by constructor or name, never by importing Markdoc
 * or Astro, so this runs wherever the config was loaded.
 */

type AttributeLike = {
  type?: unknown;
  required?: unknown;
  default?: unknown;
  matches?: unknown;
  errorLevel?: unknown;
  description?: unknown;
};

type SchemaLike = {
  render?: unknown;
  selfClosing?: unknown;
  inline?: unknown;
  children?: unknown;
  attributes?: Record<string, AttributeLike>;
  slots?: Record<string, unknown>;
  validate?: unknown;
  description?: unknown;
};

export type MarkdocConfigLike = {
  tags?: Record<string, SchemaLike | undefined>;
  nodes?: Record<string, SchemaLike | undefined>;
  variables?: Record<string, unknown>;
  functions?: Record<string, unknown>;
  partials?: Record<string, unknown>;
};

const BUILTIN_TYPES = new Map<unknown, string>([
  [String, 'String'],
  [Number, 'Number'],
  [Boolean, 'Boolean'],
  [Array, 'Array'],
  [Object, 'Object'],
]);
const TYPE_NAMES = new Set(['String', 'Number', 'Boolean', 'Array', 'Object']);

/** Tags Astro adds for its own use, never written by people. */
const INTERNAL_TAGS = new Set(['html-tag']);

export type ExtractOptions = {
  options?: { allowHTML?: boolean; ignoreIndentation?: boolean };
  hints?: Record<string, MarkdocTagHint>;
  diagnostics?: Diagnostic[];
  /** Turns a tag's attributes into settings fields (resolving widgets is the caller's business). */
  fields?: (
    tag: Omit<MarkdocTagManifest, 'fields'>,
    hint: MarkdocTagHint | undefined,
  ) => FieldModel[];
};

export function extractMarkdocSchema(
  config: MarkdocConfigLike,
  extract: ExtractOptions = {},
): MarkdocManifest {
  const hints = extract.hints ?? {};
  const diagnostics = extract.diagnostics ?? [];
  const tags: MarkdocTagManifest[] = [];
  for (const [name, schema] of Object.entries(config.tags ?? {})) {
    if (!schema || INTERNAL_TAGS.has(name)) continue;
    const hint = hints[name];
    const tag = tagOf(name, schema, hint);
    tags.push({ ...tag, fields: extract.fields?.(tag, hint) ?? [] });
    checkHint(name, tag, hint, diagnostics);
  }
  for (const name of Object.keys(hints)) {
    if (!tags.some((tag) => tag.name === name)) {
      diagnostics.push({
        level: 'warning',
        code: 'markdoc-hint',
        message: `vesper.config.ts has hints for the Markdoc tag "${name}", but markdoc.config doesn't define it.`,
      });
    }
  }
  return {
    options: {
      allowHTML: extract.options?.allowHTML === true,
      ignoreIndentation: extract.options?.ignoreIndentation === true,
    },
    tags,
    nodes: Object.entries(config.nodes ?? {}).flatMap(([name, schema]) =>
      schema?.attributes ? [{ name, attributes: attributesOf(schema.attributes) }] : [],
    ),
    variables: variablesOf(config.variables ?? {}, 0),
    functions: Object.keys(config.functions ?? {}),
    partials: Object.keys(config.partials ?? {}),
  };
}

function tagOf(
  name: string,
  schema: SchemaLike,
  hint: MarkdocTagHint | undefined,
): Omit<MarkdocTagManifest, 'fields'> {
  const attributes = attributesOf(schema.attributes ?? {});
  const render = renderName(schema.render);
  const children = Array.isArray(schema.children)
    ? schema.children.filter((c): c is string => typeof c === 'string')
    : undefined;
  const description =
    hint?.description ?? (typeof schema.description === 'string' ? schema.description : undefined);
  return {
    name,
    label: hint?.label ?? humanize(name),
    ...(hint?.summary ? { summary: hint.summary } : {}),
    ...(description ? { description } : {}),
    ...(render ? { render } : {}),
    selfClosing: schema.selfClosing === true,
    ...(typeof schema.inline === 'boolean' ? { inline: schema.inline } : {}),
    ...(children ? { children } : {}),
    attributes,
    ...(schema.slots ? { slots: Object.keys(schema.slots) } : {}),
    ...(typeof schema.validate === 'function' ? { customValidation: true } : {}),
  };
}

function attributesOf(attributes: Record<string, AttributeLike>): MarkdocAttributeManifest[] {
  return Object.entries(attributes).map(([name, attribute]) => {
    const { types, customType } = typesOf(attribute.type);
    const matches = matchesOf(attribute.matches);
    const fallback = plainJson(attribute.default);
    return {
      name,
      types,
      ...(customType ? { customType } : {}),
      required: attribute.required === true,
      ...(fallback !== undefined ? { default: fallback } : {}),
      ...(matches ? { matches } : {}),
      ...(typeof attribute.errorLevel === 'string' ? { errorLevel: attribute.errorLevel } : {}),
      ...(typeof attribute.description === 'string' ? { description: attribute.description } : {}),
    };
  });
}

function typesOf(type: unknown): { types: string[]; customType?: string } {
  const list: unknown[] = Array.isArray(type) ? type : type === undefined ? [] : [type];
  const types: string[] = [];
  let customType: string | undefined;
  for (const entry of list) {
    const builtin = BUILTIN_TYPES.get(entry);
    if (builtin) types.push(builtin);
    else if (typeof entry === 'string' && TYPE_NAMES.has(entry)) types.push(entry);
    else if (typeof entry === 'function')
      customType = (entry as { name?: string }).name || 'custom';
  }
  return customType ? { types, customType } : { types };
}

function matchesOf(matches: unknown): MarkdocMatches | undefined {
  if (matches instanceof RegExp) return { pattern: matches.source, flags: matches.flags };
  if (typeof matches === 'function') return { dynamic: true };
  if (Array.isArray(matches)) {
    const values = matches.filter(
      (v): v is string | number | boolean | null =>
        v === null || ['string', 'number', 'boolean'].includes(typeof v),
    );
    return { values };
  }
  return undefined;
}

/** A render target by name: a component's path (Astro's `component()`), or an element name. */
function renderName(render: unknown): string | undefined {
  if (typeof render === 'string') return render;
  if (typeof render === 'object' && render !== null) {
    const { path, namedExport } = render as { path?: unknown; namedExport?: unknown };
    if (typeof path === 'string')
      return typeof namedExport === 'string' ? `${path}#${namedExport}` : path;
  }
  return undefined;
}

function variablesOf(value: Record<string, unknown>, depth: number): MarkdocVariables {
  const out: MarkdocVariables = {};
  for (const [key, inner] of Object.entries(value)) {
    out[key] =
      depth < 4 && typeof inner === 'object' && inner !== null && !Array.isArray(inner)
        ? variablesOf(inner as Record<string, unknown>, depth + 1)
        : {};
  }
  return out;
}

/** The value if it's plain JSON, else undefined (functions, classes, dates). */
function plainJson(value: unknown): unknown {
  if (value === undefined) return undefined;
  try {
    // undefined for functions and symbols, despite its type.
    const json = JSON.stringify(value) as string | undefined;
    if (json === undefined) return undefined;
    const back: unknown = JSON.parse(json);
    return JSON.stringify(back) === json ? back : undefined;
  } catch {
    return undefined;
  }
}

function checkHint(
  name: string,
  tag: Omit<MarkdocTagManifest, 'fields'>,
  hint: MarkdocTagHint | undefined,
  diagnostics: Diagnostic[],
): void {
  if (!hint) return;
  const names = new Set(tag.attributes.map((a) => a.name));
  if (hint.summary && !names.has(hint.summary)) {
    diagnostics.push({
      level: 'warning',
      code: 'markdoc-hint',
      message: `vesper.config.ts names "${hint.summary}" as the summary of the Markdoc tag "${name}", which has no such attribute.`,
    });
  }
  for (const attribute of Object.keys(hint.attributes ?? {})) {
    if (!names.has(attribute)) {
      diagnostics.push({
        level: 'warning',
        code: 'markdoc-hint',
        message: `vesper.config.ts has hints for "${attribute}" on the Markdoc tag "${name}", which has no such attribute.`,
      });
    }
  }
}
