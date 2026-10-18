import type { FieldIssue, FieldModel } from '@vesper/core';
import { builtinWidget } from '../widgets/registry.ts';
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
      models = item.children ?? [];
    } else {
      const next = models.find((candidate) => keyOf(candidate) === segment);
      if (!next || (model && !usesChildren(model))) break;
      model = next;
      models = next.children ?? [];
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
