import Markdoc, { type Config, type Schema, type SchemaAttribute } from '@markdoc/markdoc';
import type { MarkdocAttributeManifest, MarkdocManifest } from './types.ts';

/*
 * A Markdoc config rebuilt from the manifest, for `Markdoc.validate()` in
 * the browser (spec §6.5.1, "Validation"). It has every part that is plain
 * data: types, `matches`, `required`, `children`, `selfClosing`, `inline`
 * and slots. Custom attribute classes and `validate` functions are code, so
 * they run where the site's real config is loaded: the dev API, on save.
 */

const TYPES: Record<string, SchemaAttribute['type']> = {
  String,
  Number,
  Boolean,
  Array,
  Object,
};

export function markdocConfigFromManifest(manifest: MarkdocManifest | undefined): Config {
  if (!manifest) return {};
  const tags: Record<string, Schema> = {};
  for (const tag of manifest.tags) {
    tags[tag.name] = {
      attributes: attributesOf(tag.attributes),
      ...(tag.selfClosing ? { selfClosing: true } : {}),
      ...(tag.inline !== undefined ? { inline: tag.inline } : {}),
      ...(tag.children ? { children: tag.children as Schema['children'] } : {}),
      ...(tag.slots ? { slots: Object.fromEntries(tag.slots.map((slot) => [slot, {}])) } : {}),
    };
  }
  const nodes: Record<string, Schema> = {};
  const defaults = Markdoc.nodes as Record<string, Schema | undefined>;
  for (const node of manifest.nodes) {
    nodes[node.name] = {
      ...(defaults[node.name] ?? {}),
      attributes: attributesOf(node.attributes),
    };
  }
  return {
    tags,
    nodes,
    functions: Object.fromEntries(manifest.functions.map((name) => [name, {}])),
  };
}

function attributesOf(
  attributes: readonly MarkdocAttributeManifest[],
): Record<string, SchemaAttribute> {
  const out: Record<string, SchemaAttribute> = {};
  for (const attribute of attributes) {
    const types = attribute.customType ? [] : attribute.types.flatMap((name) => TYPES[name] ?? []);
    const { matches } = attribute;
    out[attribute.name] = {
      ...(types.length === 1 ? { type: types[0] } : types.length > 1 ? { type: types } : {}),
      ...(attribute.required ? { required: true } : {}),
      ...(attribute.default !== undefined ? { default: attribute.default } : {}),
      ...(matches && 'values' in matches ? { matches: matches.values } : {}),
      ...(matches && 'pattern' in matches
        ? { matches: new RegExp(matches.pattern, matches.flags) }
        : {}),
      ...(attribute.errorLevel ? { errorLevel: attribute.errorLevel } : {}),
    } as SchemaAttribute;
  }
  return out;
}
