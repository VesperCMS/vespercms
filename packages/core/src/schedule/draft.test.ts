import { describe, expect, it } from 'vitest';
import type { FieldModel } from '../field-model.ts';
import { hasDraftField, isDraft } from './draft.ts';

const field = (path: string[], kind: FieldModel['kind']): FieldModel => ({
  path,
  kind,
  required: false,
  label: path.join(' '),
});

describe('drafts', () => {
  const blog = { fields: [field(['title'], 'string'), field(['draft'], 'boolean')] };

  it('are entries with `draft: true`, in a collection with a top-level true-or-false `draft`', () => {
    expect(hasDraftField(blog)).toBe(true);
    expect(isDraft(blog, { title: 'Notes', draft: true })).toBe(true);
    expect(isDraft(blog, { title: 'Notes', draft: false })).toBe(false);
    expect(isDraft(blog, { title: 'Notes' })).toBe(false);
    // Only `true` itself: a string isn't what the field holds.
    expect(isDraft(blog, { draft: 'true' })).toBe(false);
  });

  it('mean nothing in a collection without the field, or with one that isn’t true or false', () => {
    expect(isDraft({ fields: [field(['title'], 'string')] }, { draft: true })).toBe(false);
    expect(isDraft({ fields: [field(['draft'], 'string')] }, { draft: true })).toBe(false);
    expect(isDraft({ fields: [field(['seo', 'draft'], 'boolean')] }, { draft: true })).toBe(false);
    expect(isDraft({}, { draft: true })).toBe(false);
  });
});
