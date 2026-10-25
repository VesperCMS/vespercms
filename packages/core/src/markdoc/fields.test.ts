import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { markdocFields } from './fields.ts';
import type { MarkdocAttributeManifest } from './types.ts';

const items: MarkdocAttributeManifest = { name: 'items', types: ['Array'], required: true };

describe('a Markdoc list attribute’s settings field', () => {
  it('is raw YAML without a hint, since Markdoc says nothing about what’s inside', () => {
    expect(markdocFields({ attributes: [items] })[0]).toMatchObject({
      kind: 'unknown',
      unknownReason: 'markdoc:Array',
    });
  });

  it('takes its shape from a Zod schema hint, keeping Markdoc’s required and the hint’s label', () => {
    const schema = z
      .array(z.object({ question: z.string(), answer: z.string().meta({ widget: 'textarea' }) }))
      .default([]);
    const [field] = markdocFields(
      { attributes: [items] },
      { attributes: { items: { label: 'Questions', schema } } },
    );
    expect(field).toMatchObject({
      path: ['items'],
      kind: 'array',
      label: 'Questions',
      required: true,
    });
    expect(field).not.toHaveProperty('default');
    expect(
      field?.children?.[0]?.children?.map((child) => [child.path.at(-1), child.widget]),
    ).toEqual([
      ['question', undefined],
      ['answer', 'textarea'],
    ]);
  });

  it('ignores a schema on an attribute that isn’t a list or an object', () => {
    const [field] = markdocFields(
      { attributes: [{ name: 'title', types: ['String'], required: false }] },
      { attributes: { title: { schema: z.array(z.string()) } } },
    );
    expect(field?.kind).toBe('string');
  });
});
