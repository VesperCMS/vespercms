import type { FieldModel } from '../field-model.ts';

/*
 * The manifest's `markdoc` and `mdx` sections (spec §6.5.1, §6.5.2): the
 * schema parts of the site's Markdoc config and its declared MDX
 * components, as plain JSON. `render` targets are recorded by name only,
 * and variables by their keys only, never their values.
 */

/** Values a Markdoc attribute's `matches` allows, or a pattern, or `dynamic` for a function. */
export type MarkdocMatches =
  | { values: (string | number | boolean | null)[] }
  | { pattern: string; flags: string }
  | { dynamic: true };

export type MarkdocAttributeManifest = {
  name: string;
  /**
   * Markdoc's built-in type names (`String`, `Number`, `Boolean`, `Array`,
   * `Object`); several for a union. Empty when the attribute takes any value
   * or uses a custom type class (named in `customType`).
   */
  types: string[];
  customType?: string;
  required: boolean;
  /** The default, when it's plain JSON. */
  default?: unknown;
  matches?: MarkdocMatches;
  errorLevel?: string;
  description?: string;
};

export type MarkdocTagManifest = {
  name: string;
  /** The friendly name: the `vesper.config.ts` hint, or the humanized tag name. */
  label: string;
  /** The attribute whose value the block's header shows ("Callout · Warning"). */
  summary?: string;
  description?: string;
  /** What it renders, by name only: a component path or an element name. */
  render?: string;
  selfClosing: boolean;
  /** `true` or `false` when the schema says; absent when the tag may be either. */
  inline?: boolean;
  /** Node types allowed inside. Absent means anything. */
  children?: string[];
  attributes: MarkdocAttributeManifest[];
  slots?: string[];
  /** The settings form, in attribute order. */
  fields: FieldModel[];
  /** The tag has its own `validate` function, which only runs where the real config is loaded. */
  customValidation?: boolean;
};

export type MarkdocNodeManifest = { name: string; attributes: MarkdocAttributeManifest[] };

/** A variable's keys, nested; a leaf is `{}`. */
export type MarkdocVariables = { [key: string]: MarkdocVariables };

export type MarkdocManifest = {
  /** The @astrojs/markdoc options that change parsing. */
  options: { allowHTML: boolean; ignoreIndentation: boolean };
  tags: MarkdocTagManifest[];
  /** Node schemas the site's config sets, with their attributes (Astro's heading ids, for one). */
  nodes: MarkdocNodeManifest[];
  variables: MarkdocVariables;
  functions: string[];
  /** Names of partials the config registers itself (`partials: { … }`). */
  partials: string[];
};

export type MdxComponentManifest = {
  name: string;
  label: string;
  description?: string;
  summary?: string;
  /** Takes children (shown as an editable frame) rather than being a card. */
  children: boolean;
  /** Inserted inline, inside a paragraph, rather than as a block. */
  inline: boolean;
  /** Fields from the props schema, or null when it has none the studio can read. */
  fields: FieldModel[] | null;
};

export type MdxManifest = { components: MdxComponentManifest[] };

/** UI hints for one tag in `vesper.config.ts` (spec §6.5.1). Never in markdoc.config.mjs. */
export type MarkdocTagHint = {
  label?: string;
  description?: string;
  summary?: string;
  attributes?: Record<
    string,
    { label?: string; description?: string; labels?: Record<string, string>; widget?: string }
  >;
};

/** A declared MDX component in `vesper.config.ts` (spec §6.5.2). */
export type MdxComponentConfig = {
  label?: string;
  description?: string;
  summary?: string;
  children?: boolean;
  inline?: boolean;
  /** A Zod object schema for the component's props. */
  props?: unknown;
};
