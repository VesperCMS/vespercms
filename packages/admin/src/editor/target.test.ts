import { describe, expect, it } from 'vitest';
import { playgroundManifest } from '../test/helpers.tsx';
import { issuePlace } from './target.ts';

const pages = playgroundManifest.collections.find((c) => c.name === 'pages');
const fields = pages?.fields ?? [];

const values = {
  title: 'Tuition and fees',
  blocks: [
    { type: 'text', heading: 'Paying in parts', body: 'Four payments.' },
    { type: 'figure', image: { src: './a.jpg', alt: 'IMG_2041.jpg' } },
    {
      type: 'faq',
      heading: 'Questions about cost',
      items: [{ question: 'Are books included?', answer: 'No.' }],
    },
  ],
};

describe('issuePlace', () => {
  it('names a top-level field by its label', () => {
    expect(issuePlace(fields, ['title'], values)).toBe('Title');
  });

  it('names an item in blocks by its place and kind, and an image by its alt text', () => {
    // Beside the field this is "Image, alt"; in the drawer it needs its block.
    expect(issuePlace(fields, ['blocks', 1, 'image', 'alt'], values)).toBe(
      'Block 2 (Figure) › Image, alt',
    );
  });

  it('names items in a list inside a block', () => {
    expect(issuePlace(fields, ['blocks', 2, 'items', 0, 'answer'], values)).toBe(
      'Block 3 (FAQ) › Item 1 › Answer',
    );
  });

  it('stops at the deepest field the form shows', () => {
    expect(issuePlace(fields, ['blocks', 0], values)).toBe('Block 1 (Text)');
    expect(issuePlace(fields, ['nothing-here'], values)).toBe('Entry');
  });
});
