import type { CollectionManifest } from '@vesper/core';
import { describe, expect, it } from 'vitest';
import { playgroundManifest } from '../test/helpers.tsx';
import { copiedValues } from './copy.ts';

const collection = (name: string): CollectionManifest => {
  const found = playgroundManifest.collections.find((c) => c.name === name);
  if (!found) throw new Error(name);
  return found;
};

describe('copiedValues', () => {
  it('adds " (copy)" to the title and keeps every other value, images with their crops', () => {
    const hero = {
      src: '../../assets/blog/harbor-at-dawn.jpg',
      alt: 'An orange sun over a harbor',
      focus: { x: 0.62, y: 0.35 },
      crops: { square: { x: 0.4, y: 0.1, w: 0.45, h: 0.675 } },
    };
    expect(
      copiedValues(collection('blog'), { title: 'Harbor at dawn', hero, tags: ['harbor'] }),
    ).toEqual({ title: 'Harbor at dawn (copy)', hero, tags: ['harbor'] });
  });

  it('leaves out the slug widget’s fields and a slug Astro would take as the ID', () => {
    // authors.handle is shown with the slug widget, following the name.
    expect(
      copiedValues(collection('authors'), { name: 'Ada Moreno', handle: 'ada-moreno', bio: 'x' }),
    ).toEqual({ name: 'Ada Moreno (copy)', bio: 'x' });
    expect(copiedValues(collection('blog'), { title: 'Odd', slug: 'custom-slug' })).toEqual({
      title: 'Odd (copy)',
    });
  });

  it('leaves an empty title empty', () => {
    expect(copiedValues(collection('blog'), { title: '' })).toEqual({ title: '' });
  });
});
