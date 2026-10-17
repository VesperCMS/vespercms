import { describe, expect, it } from 'vitest';
import { customConditions } from './load-site.ts';

describe('customConditions', () => {
  it('reads --conditions and -C from argv and NODE_OPTIONS', () => {
    expect(customConditions(['--conditions=@vesper/source'], undefined)).toEqual([
      '@vesper/source',
    ]);
    expect(
      customConditions(
        ['-C', 'development'],
        '--conditions=@vesper/source --max-old-space-size=4096',
      ),
    ).toEqual(['development', '@vesper/source']);
  });

  it('returns nothing for a plain process, and drops duplicates', () => {
    expect(customConditions([], undefined)).toEqual([]);
    expect(customConditions(['--conditions=a'], '--conditions=a')).toEqual(['a']);
  });
});
