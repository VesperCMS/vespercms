import {
  humanize,
  jsxClosing,
  jsxOpening,
  markdocClosing,
  markdocOpening,
  type BodyFormat,
  type FieldModel,
  type Manifest,
} from '@vespercms/core';

/*
 * What the writing view knows how to show as a block (spec §6.5.1, §6.5.2):
 * the site's Markdoc tags, Markdoc's own `partial` and `if`, and declared
 * MDX components. Anything else is a protected source chip.
 */

export type BlockShape = 'container' | 'card' | 'inline';

export type BlockKind = {
  /** `markdoc:callout`, `mdx:Callout`. */
  key: string;
  syntax: 'markdoc' | 'mdx';
  name: string;
  label: string;
  summary?: string;
  description?: string;
  /** How a new one is inserted at a block position, or null when it can only go inline. */
  block: Exclude<BlockShape, 'inline'> | null;
  /** Whether it can go inside a line of text. */
  inline: boolean;
  /** Written without content (`/%}`, `/>`). */
  selfClosing: boolean;
  /** Markdoc's allowed child node types (containers); absent means anything. */
  children?: string[];
  /** The settings form. */
  fields: FieldModel[];
  /** Attribute order, for placing new attributes and writing new tags. */
  order: string[];
  /** Built-in constructs the studio handles itself: partials, conditions and pipe tables. */
  builtin?: 'partial' | 'if' | 'else' | 'table';
};

export type Catalog = {
  format: BodyFormat;
  kinds: Map<string, BlockKind>;
  /** The kind for a tag or component name in this body's syntax. */
  find: (syntax: 'markdoc' | 'mdx', name: string) => BlockKind | undefined;
};

const PARTIAL_FIELD: FieldModel = {
  path: ['file'],
  kind: 'string',
  required: true,
  label: 'File',
  description: 'The partial’s file, shown here as part of this page.',
};

export function catalogOf(manifest: Manifest, format: BodyFormat): Catalog {
  const kinds = new Map<string, BlockKind>();
  if (format === 'mdoc') {
    for (const tag of manifest.markdoc?.tags ?? []) {
      const block: BlockKind['block'] =
        tag.inline === true ? null : tag.selfClosing ? 'card' : 'container';
      // A tag that doesn't say may go either way in Markdoc. Offered inline,
      // it's one that neither holds blocks nor stands alone as a card.
      const inline =
        tag.inline === true || (tag.inline === undefined && !tag.selfClosing && !tag.children);
      kinds.set(`markdoc:${tag.name}`, {
        key: `markdoc:${tag.name}`,
        syntax: 'markdoc',
        name: tag.name,
        label: tag.label,
        ...(tag.summary ? { summary: tag.summary } : {}),
        ...(tag.description ? { description: tag.description } : {}),
        block,
        inline,
        selfClosing: tag.selfClosing,
        ...(tag.children ? { children: tag.children } : {}),
        fields: tag.fields,
        order: tag.attributes.map((a) => a.name),
      });
    }
    if (!kinds.has('markdoc:partial')) {
      kinds.set('markdoc:partial', {
        key: 'markdoc:partial',
        syntax: 'markdoc',
        name: 'partial',
        label: 'Partial',
        summary: 'file',
        description: 'Text kept in its own file and shown here.',
        block: 'card',
        inline: false,
        selfClosing: true,
        fields: [PARTIAL_FIELD],
        order: ['file', 'variables'],
        builtin: 'partial',
      });
    }
    kinds.set('markdoc:if', {
      key: 'markdoc:if',
      syntax: 'markdoc',
      name: 'if',
      label: 'Conditional content',
      block: 'container',
      inline: false,
      selfClosing: false,
      fields: [],
      order: [],
      builtin: 'if',
    });
    kinds.set('markdoc:else', {
      key: 'markdoc:else',
      syntax: 'markdoc',
      name: 'else',
      label: 'Otherwise',
      block: 'card',
      inline: false,
      selfClosing: true,
      fields: [],
      order: [],
      builtin: 'else',
    });
  }
  if (format === 'mdx') {
    for (const component of manifest.mdx?.components ?? []) {
      kinds.set(`mdx:${component.name}`, {
        key: `mdx:${component.name}`,
        syntax: 'mdx',
        name: component.name,
        label: component.label,
        ...(component.summary ? { summary: component.summary } : {}),
        ...(component.description ? { description: component.description } : {}),
        block: component.inline ? null : component.children ? 'container' : 'card',
        inline: component.inline,
        selfClosing: !component.children,
        fields: component.fields ?? [],
        order: (component.fields ?? []).map((f) => f.path[0] ?? ''),
      });
    }
  }
  return {
    format,
    kinds,
    find: (syntax, name) => kinds.get(`${syntax}:${name}`),
  };
}

/** Kinds a person can insert (built-in conditions are protected, so they aren't offered). */
/**
 * A pipe table, insertable in every format (PLAN.md, call T4). It isn't one
 * of the catalog's kinds, so Markdoc's own `{% table %}` is never taken for it.
 */
export const TABLE_KIND: BlockKind = {
  key: 'table',
  syntax: 'markdoc',
  name: 'table',
  label: 'Table',
  block: 'card',
  inline: false,
  selfClosing: true,
  fields: [],
  order: [],
  builtin: 'table',
};

export function insertable(catalog: Catalog): BlockKind[] {
  return [
    ...[...catalog.kinds.values()].filter(
      (kind) => kind.builtin !== 'if' && kind.builtin !== 'else',
    ),
    TABLE_KIND,
  ];
}

/** A new tag's text in house style: attributes in schema order, empty and default values left out. */
export function newTagText(
  kind: BlockKind,
  attributes: Readonly<Record<string, unknown>>,
  shape: BlockShape,
  inner = '',
): { open: string; close: string; whole: string } {
  const pairs = kind.order.map((name) => [name, attributes[name]] as const);
  const selfClosing = shape === 'card' || (shape === 'inline' && kind.selfClosing);
  if (kind.syntax === 'markdoc') {
    const open = markdocOpening(kind.name, pairs, selfClosing);
    const close = selfClosing ? '' : markdocClosing(kind.name);
    return { open, close, whole: shape === 'inline' ? open + inner + close : open };
  }
  const open = jsxOpening(kind.name, pairs, selfClosing);
  const close = selfClosing ? '' : jsxClosing(kind.name);
  return { open, close, whole: shape === 'inline' ? open + inner + close : open };
}

/** A friendly name for a tag nobody described: the humanized name, or the component's own. */
export function fallbackLabel(syntax: 'markdoc' | 'mdx', name: string): string {
  return syntax === 'mdx' ? name : humanize(name);
}
