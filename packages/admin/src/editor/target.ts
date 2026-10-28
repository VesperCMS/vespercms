import {
  fieldChildren,
  isPlainObject,
  type DataValue,
  type FieldIssue,
  type FieldModel,
} from '@vespercms/core';
import { itemNames } from '../widgets/group.tsx';
import { builtinWidget } from '../widgets/registry.ts';
import { kindRow } from '../widgets/union.tsx';
import { fieldId, keyOf, type ValuePath } from './values.ts';

/**
 * Where an issue is shown: the deepest field on screen along its path. An
 * issue inside a raw field, or in a nested value no control shows, lands on
 * the nearest field that is shown.
 */
export function issueTarget(
  fields: readonly FieldModel[],
  path: FieldIssue['path'],
): { path: ValuePath; focusId: string; label: string } {
  let models: readonly FieldModel[] = fields;
  let model: FieldModel | undefined;
  const matched: (string | number)[] = [];
  for (const segment of path) {
    if (typeof segment === 'number') {
      const item = model?.kind === 'array' ? model.children?.[0] : undefined;
      if (!item || !usesChildren(model)) break;
      model = item;
      models = fieldChildren(item);
    } else {
      // A kind's fields are found by key among every kind's: their ids come from the value's path.
      const next = models.find((candidate) => keyOf(candidate) === segment);
      if (!next || (model && !usesChildren(model))) break;
      model = next;
      models = fieldChildren(next);
    }
    matched.push(segment);
  }
  if (!model) return { path: [], focusId: 'main', label: 'Entry' };
  const id = fieldId(matched);
  const widget = builtinWidget(model);
  // A widget that draws its own control for the child at fault (an image's alt text) gets focus there.
  const child = path[matched.length];
  const childSuffix = typeof child === 'string' ? widget.childControls?.[child] : undefined;
  const childLabel = models.find((m) => keyOf(m) === child)?.label;
  return {
    path: matched,
    focusId: childSuffix ? `${id}${childSuffix}` : widget.group ? `${id}-label` : id,
    label: childSuffix && childLabel ? `${model.label}, ${childLabel.toLowerCase()}` : model.label,
  };
}

/** Whether a field's widget shows its children as their own fields (groups and repeaters do). */
function usesChildren(field: FieldModel | undefined): boolean {
  if (!field) return true;
  return builtinWidget(field).rendersChildren === true;
}

/**
 * Where an issue is, in words, for a list of notes away from the form:
 * "Section 2 (Showcase) › Image, alt". Beside its field, the field's own
 * label is enough, but in the notes drawer two images in blocks would both
 * read "Image, alt". A list item is named by its place and, in blocks, its
 * kind, which says the list's name too ("Section 2"), so the list's own
 * label is left out before it.
 */
export function issuePlace(
  fields: readonly FieldModel[],
  path: FieldIssue['path'],
  values: DataValue,
): string {
  const target = issueTarget(fields, path);
  const parts: string[] = [];
  let models: readonly FieldModel[] = fields;
  let model: FieldModel | undefined;
  let value: DataValue | undefined = values;
  for (const segment of target.path) {
    if (typeof segment === 'number') {
      const item = model?.children?.[0];
      if (!model || !item) break;
      const held = Array.isArray(value) ? value[segment] : undefined;
      const one = itemNames(model).one;
      const kind = item.kind === 'union' ? ` (${kindRow(held ?? null, item).name})` : '';
      parts.pop();
      parts.push(
        `${one.charAt(0).toLocaleUpperCase()}${one.slice(1)} ${String(segment + 1)}${kind}`,
      );
      model = item;
      models = fieldChildren(item);
      value = held;
    } else {
      const next = models.find((candidate) => keyOf(candidate) === segment);
      if (!next) break;
      parts.push(next.label);
      model = next;
      models = fieldChildren(next);
      value = isPlainObject(value) ? value[segment] : undefined;
    }
  }
  // The field itself keeps the name it has beside the control ("Image, alt").
  if (typeof target.path.at(-1) === 'string') parts.splice(-1, 1, target.label);
  return parts.length > 0 ? parts.join(' › ') : target.label;
}
