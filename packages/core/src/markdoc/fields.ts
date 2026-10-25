import type { FieldModel } from '../field-model.ts';
import { humanize } from '../schema/humanize.ts';
import { walkField } from '../schema/walk.ts';
import type { MarkdocAttributeManifest, MarkdocTagHint, MarkdocTagManifest } from './types.ts';

/*
 * A tag's settings form (spec §6.5.1, "Settings form"): one field model per
 * attribute, so the form renders with the same widgets as frontmatter.
 *
 * | Markdoc attribute            | Control                                  |
 * | String with an array matches | Radio group (4 or fewer), else select    |
 * | String with a RegExp matches | Text field with pattern validation       |
 * | String, or a custom class    | Text field (the class validates on save) |
 * | Number                       | Number field                             |
 * | Boolean                      | Switch                                   |
 * | Array, Object, with a schema | The frontmatter's widgets for that shape |
 * | Array, Object, anything else | Raw YAML field                           |
 */

export function markdocFields(
  tag: Pick<MarkdocTagManifest, 'attributes'>,
  hint?: MarkdocTagHint,
): FieldModel[] {
  return tag.attributes.map((attribute) => fieldOf(attribute, hint?.attributes?.[attribute.name]));
}

function fieldOf(
  attribute: MarkdocAttributeManifest,
  hint: NonNullable<MarkdocTagHint['attributes']>[string] | undefined,
): FieldModel {
  const description = hint?.description ?? attribute.description;
  const base = {
    path: [attribute.name],
    required: attribute.required,
    label: hint?.label ?? humanize(attribute.name),
    ...(description ? { description } : {}),
    ...(attribute.default !== undefined ? { default: attribute.default } : {}),
    ...(hint?.widget ? { widget: hint.widget } : {}),
  };
  const [only, ...others] = attribute.types;
  const single = others.length === 0 ? only : undefined;
  const matches = attribute.matches;

  if ((single === 'String' || single === undefined) && matches && 'values' in matches) {
    const values = matches.values.filter((v): v is string => typeof v === 'string');
    if (values.length === matches.values.length && values.length > 0) {
      return {
        ...base,
        kind: 'enum',
        widget: hint?.widget ?? (values.length <= 4 ? 'radio' : 'select'),
        constraints: {
          options: values.map((value) => ({
            value,
            label: hint?.labels?.[value] ?? humanize(value),
          })),
        },
      };
    }
  }
  if (single === 'String' || (single === undefined && attribute.customType)) {
    return {
      ...base,
      kind: 'string',
      ...(matches && 'pattern' in matches
        ? {
            constraints: {
              pattern: matches.pattern,
              ...(matches.flags ? { patternFlags: matches.flags } : {}),
            },
          }
        : {}),
    };
  }
  if (single === 'Number') return { ...base, kind: 'number' };
  // Markdoc can't say what's inside a list or an object; a schema hint can.
  if (hint?.schema !== undefined && attribute.types.some((t) => t === 'Array' || t === 'Object')) {
    const shaped = walkField(hint.schema, [attribute.name], { diagnostics: [], seen: new Set() });
    if (shaped.kind !== 'unknown') {
      // Markdoc's own required, default, label and help win: they're what the site checks.
      const { required: _required, default: _default, ...shape } = shaped;
      return { ...shape, ...base };
    }
  }
  if (single === 'Boolean') return { ...base, kind: 'boolean' };
  return {
    ...base,
    kind: 'unknown',
    unknownReason: single ? `markdoc:${single}` : 'markdoc:any',
  };
}
