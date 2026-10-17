import { describe, expect, it } from 'vitest';
import { formatYamlSnippet, parseYamlSnippet } from './text.ts';

describe('formatYamlSnippet and parseYamlSnippet', () => {
  it('round-trips the values a raw field holds', () => {
    for (const value of [
      { kind: 'video', id: 'abc' },
      ['a', 'b'],
      42,
      'plain',
      true,
      new Date('2026-10-17T09:30:00.000Z'),
    ]) {
      const parsed = parseYamlSnippet(formatYamlSnippet(value));
      expect(parsed).toEqual({ ok: true, value });
    }
  });

  it('treats empty text as no value', () => {
    expect(formatYamlSnippet(undefined)).toBe('');
    expect(parseYamlSnippet('  \n')).toEqual({ ok: true, value: undefined });
  });

  it('explains invalid YAML with its line', () => {
    const result = parseYamlSnippet('a: 1\nb: [unclosed');
    expect(result.ok).toBe(false);
    expect(!result.ok && result.message).toMatch(/^This isn’t valid YAML \(line \d\)/);
  });
});
