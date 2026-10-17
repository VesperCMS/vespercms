import { load as jsYamlLoad } from 'js-yaml';
import { parseDocument, type Document, type SchemaOptions } from 'yaml';
import { deepEqual, type DataValue } from '../equal.ts';

/**
 * Astro 7.4's YAML options, from `@astrojs/internal-helpers/yaml`. Astro uses
 * them for frontmatter (Markdown, MDX, Markdoc) and for YAML data files alike.
 * Reading with exactly these means the editor sees the values the site sees.
 */
export const ASTRO_YAML_OPTIONS: Readonly<Pick<SchemaOptions, 'customTags' | 'merge' | 'schema'>> =
  {
    customTags: ['timestamp'],
    merge: true,
    schema: 'core',
  };

/** Why a YAML block can't be edited structurally, only as raw text. */
export type SourceOnlyReason =
  /** `yaml` (Astro 7.4+) rejects it, so the site can't build it either. */
  | 'yaml-error'
  /** js-yaml (Astro 6.x–7.3) rejects it, or reads different values from `yaml`. */
  | 'parsers-disagree'
  /** The block isn't a mapping (frontmatter must be one). */
  | 'not-a-map';

export type YamlRead =
  | {
      editable: true;
      /** The parsed value. An empty block reads as `{}`, as Astro treats it. */
      value: DataValue;
      /** Parsed with source tokens kept, for locating nodes to edit. */
      doc: Document.Parsed;
    }
  | {
      editable: false;
      reason: SourceOnlyReason;
      /** Best-effort value for display, from whichever parser accepted it. */
      value: DataValue;
      message: string;
    };

function parseWithYaml(raw: string): { doc: Document.Parsed; value: DataValue } {
  const doc = parseDocument(raw, { ...ASTRO_YAML_OPTIONS, keepSourceTokens: true });
  const [error] = doc.errors;
  if (error) throw error;
  return { doc, value: (doc.contents === null ? undefined : doc.toJS()) as DataValue };
}

function parseWithJsYaml(raw: string): DataValue {
  return jsYamlLoad(raw) as DataValue;
}

const normalizeEmpty = (value: DataValue): DataValue =>
  value === null || value === undefined ? {} : value;

/**
 * Reads a YAML block (frontmatter or a data file) and decides whether the
 * editor may change it structurally.
 *
 * It must parse cleanly in `yaml` (what Astro 7.4+ uses) and give the same
 * values in js-yaml (what Astro 6.x–7.3 use). Where the two disagree, a
 * structural save could change content for one Astro version without
 * anyone touching it, so the block is offered as raw text instead.
 *
 * @param expect `map` for frontmatter and object-shaped data files; `any` for
 *   data files that may be a top-level sequence.
 */
export function readYaml(raw: string, expect: 'map' | 'any' = 'map'): YamlRead {
  let parsed: { doc: Document.Parsed; value: DataValue };
  try {
    parsed = parseWithYaml(raw);
  } catch (error) {
    let fallback: DataValue;
    try {
      fallback = parseWithJsYaml(raw);
    } catch {
      fallback = undefined;
    }
    return { editable: false, reason: 'yaml-error', value: fallback, message: messageOf(error) };
  }

  const value = expect === 'map' ? normalizeEmpty(parsed.value) : parsed.value;
  let other: DataValue;
  try {
    other = parseWithJsYaml(raw);
  } catch (error) {
    return { editable: false, reason: 'parsers-disagree', value, message: messageOf(error) };
  }
  if (!deepEqual(value, expect === 'map' ? normalizeEmpty(other) : other)) {
    return {
      editable: false,
      reason: 'parsers-disagree',
      value,
      message: 'Astro 7.4+ and older Astro versions read different values from this YAML.',
    };
  }
  if (
    expect === 'map' &&
    (typeof value !== 'object' || value === null || Array.isArray(value) || value instanceof Date)
  ) {
    return {
      editable: false,
      reason: 'not-a-map',
      value,
      message: 'Frontmatter must be a set of keys and values.',
    };
  }
  return { editable: true, value, doc: parsed.doc };
}

/** Reads values only, exactly as Astro 7.4 does. Throws on invalid YAML. */
export function parseYamlValue(raw: string): DataValue {
  return parseWithYaml(raw).value;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? (error.message.split('\n')[0] ?? error.message) : String(error);
}
