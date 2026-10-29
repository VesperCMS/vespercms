import { isPlainObject, type DataValue } from '../files/equal.ts';
import type { FieldModel } from '../field-model.ts';

/*
 * Drafts (DECISIONS.md, "Unpublishing is `draft: true`"): in a collection
 * with a top-level true-or-false `draft` field, an entry whose `draft` is
 * true is left out of the site's build and its search, as one outside its
 * schedule's window is. The studio's Unpublish sets it. In a collection
 * without the field, `draft` means nothing to Vesper.
 */

type WithFields = { fields?: readonly FieldModel[] | null | undefined };

/** Whether a collection's entries can be drafts: it has a top-level `draft` field that's true or false. */
export function hasDraftField(collection: WithFields): boolean {
  return (collection.fields ?? []).some(
    (field) => field.path.length === 1 && field.path[0] === 'draft' && field.kind === 'boolean',
  );
}

/** Whether the entry is a draft its collection keeps off the site. */
export function isDraft(collection: WithFields, data: DataValue): boolean {
  return hasDraftField(collection) && isPlainObject(data) && data.draft === true;
}
