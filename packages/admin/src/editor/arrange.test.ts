import type { CollectionManifest, FieldModel } from '@vesper/core';
import { describe, expect, it } from 'vitest';
import { arrangeFields } from './arrange.ts';

const field = (key: string, extra: Partial<FieldModel> = {}): FieldModel => ({
  path: [key],
  kind: 'string',
  required: false,
  label: key,
  ...extra,
});
const hide = field('hidden', {
  kind: 'boolean',
  search: 'hide',
  placement: 'details',
  label: 'Hide from site search',
});

function collection(presentation: CollectionManifest['presentation']): CollectionManifest {
  return {
    name: 'pages',
    label: 'Pages',
    editable: true,
    source: {
      loader: 'glob',
      base: 'src/content/pages',
      pattern: '**/*.md',
      generateId: 'default',
      formats: ['md'],
    },
    entryKind: 'content',
    fields: [field('title'), field('summary'), hide],
    presentation,
  };
}

const keys = (fields: FieldModel[]) => fields.map((f) => f.path.join('.'));

describe('arrangeFields', () => {
  it('puts "Hide from site search" in Details where the collection is searched', () => {
    const arranged = arrangeFields(collection({ url: '/:id', searchHidden: ['hidden'] }));
    expect(arranged.title?.path).toEqual(['title']);
    expect(keys(arranged.main)).toEqual(['summary']);
    expect(keys(arranged.details)).toEqual(['hidden']);
  });

  it('leaves the switch out, not disabled, where the collection isn’t searched', () => {
    const arranged = arrangeFields(collection({ url: '/:id', search: false }));
    expect(keys([...arranged.main, ...arranged.details])).toEqual(['summary']);
  });
});
