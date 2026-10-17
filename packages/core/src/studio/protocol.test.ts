import { describe, expect, it } from 'vitest';
import { decodeData, decodeValue, encodeValue } from './protocol.ts';

describe('encodeValue and decodeValue', () => {
  it('carries Dates through JSON as Dates', () => {
    const value = {
      title: 'A',
      published: new Date('2026-10-17T00:00:00Z'),
      list: [new Date(0), 1],
      nested: { x: null },
    };
    const roundTripped = decodeValue(JSON.parse(JSON.stringify(encodeValue(value))));
    expect(roundTripped).toEqual(value);
    expect((roundTripped as { published: Date }).published).toBeInstanceOf(Date);
  });

  it('drops undefined keys and leaves look-alike objects alone', () => {
    expect(encodeValue({ a: undefined, b: 1 })).toEqual({ b: 1 });
    expect(decodeValue({ $date: '2026-10-17', other: 1 })).toEqual({
      $date: '2026-10-17',
      other: 1,
    });
  });

  it('decodeData always gives an object', () => {
    expect(decodeData(['x'])).toEqual({});
    expect(decodeData({ a: 1 })).toEqual({ a: 1 });
  });
});
