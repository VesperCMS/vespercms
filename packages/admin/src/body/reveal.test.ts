import { parseBody } from '@vespercms/core';
import { describe, expect, it } from 'vitest';
import { blockPathAt } from './reveal.ts';

describe('blockPathAt', () => {
  const body = [
    'Intro.',
    '{% callout type="tip" %}\nFirst.\n\n[Click here](/x/).\n{% /callout %}',
    '## End',
  ].join('\n\n');
  const { blocks } = parseBody(body, 'mdoc');

  it('finds a top-level block', () => {
    expect(blockPathAt(blocks, body.indexOf('## End'))).toEqual([2]);
  });

  it('goes into a container’s children', () => {
    expect(blockPathAt(blocks, body.indexOf('[Click here]'))).toEqual([1, 1]);
  });

  it('stops at the container for its opening or closing', () => {
    expect(blockPathAt(blocks, body.indexOf('{% callout'))).toEqual([1]);
    expect(blockPathAt(blocks, body.indexOf('{% /callout'))).toEqual([1]);
  });

  it('takes the block before an offset between blocks', () => {
    expect(blockPathAt(blocks, body.indexOf('Intro.') + 7)).toEqual([0]);
  });
});
