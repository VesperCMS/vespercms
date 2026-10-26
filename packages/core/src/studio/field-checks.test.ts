import { describe, expect, it } from 'vitest';
import type { FieldModel } from '../field-model.ts';
import { fieldModelIssues } from './field-checks.ts';

const field = (key: string, extra: Partial<FieldModel>): FieldModel => ({
  path: [key],
  kind: 'string',
  required: true,
  label: key,
  ...extra,
});

describe('checks from the field model alone', () => {
  const fields: FieldModel[] = [
    field('title', {}),
    field('summary', { required: false, constraints: { max: 5 } }),
    field('category', {
      kind: 'enum',
      constraints: {
        options: [
          { value: 'news', label: 'News' },
          { value: 'guides', label: 'Guides' },
        ],
      },
    }),
    field('order', { kind: 'number', required: false, constraints: { integer: true, min: 1 } }),
    field('slug', { constraints: { pattern: '^[a-z-]+$' } }),
    field('tags', {
      kind: 'array',
      required: false,
      children: [field('[]', { path: ['tags', '[]'] })],
    }),
    field('draft', { kind: 'boolean', required: true, default: false }),
    field('publishedAt', { kind: 'date' }),
  ];

  it('reports what the site would refuse, in plain words', () => {
    expect(
      fieldModelIssues(fields, {
        summary: 'Too long',
        category: 'events',
        order: 1.5,
        slug: 'Not A Slug',
        tags: ['a', null],
      }),
    ).toEqual([
      { path: ['title'], message: 'This is required.' },
      { path: ['summary'], message: 'Use at most 5 characters.' },
      { path: ['category'], message: 'Choose one of News, Guides.' },
      { path: ['order'], message: 'Enter a whole number.' },
      { path: ['slug'], message: 'This isn’t in the form the site expects.' },
      { path: ['tags', 1], message: 'This is required.' },
      { path: ['publishedAt'], message: 'This is required.' },
    ]);
  });

  it('never refuses what the schema accepts: an empty string, defaults, dates as text', () => {
    expect(
      fieldModelIssues(fields, {
        title: '',
        category: 'news',
        slug: 'a-slug',
        publishedAt: '2026-10-19',
      }),
    ).toEqual([]);
  });

  it('checks each item against its own kind, and asks for a kind the site has', () => {
    const blocks = field('blocks', {
      kind: 'array',
      children: [
        field('[]', {
          path: ['blocks', '[]'],
          kind: 'union',
          discriminator: 'type',
          variants: [
            {
              value: 'faq',
              label: 'FAQ',
              children: [field('heading', { path: ['blocks', '[]', 'heading'] })],
            },
            { value: 'stats', label: 'Stats', children: [] },
          ],
        }),
      ],
    });
    expect(
      fieldModelIssues([blocks], {
        blocks: [{ type: 'faq' }, { type: 'stats' }, { type: 'hero' }, {}],
      }),
    ).toEqual([
      { path: ['blocks', 0, 'heading'], message: 'This is required.' },
      { path: ['blocks', 2, 'type'], message: 'Choose one of the kinds the site has.' },
      { path: ['blocks', 3, 'type'], message: 'Choose one of the kinds the site has.' },
    ]);
  });
});
