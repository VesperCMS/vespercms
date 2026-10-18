import { describe, expect, it } from 'vitest';
import { RATIO_NAME, isRatio, ratioLabel, siteRatios } from './ratios.ts';

describe('siteRatios', () => {
  it('adds the built-in og ratio after the site’s own', () => {
    expect(siteRatios({ wide: 16 / 9, square: 1 })).toEqual({ wide: 16 / 9, square: 1, og: 1.91 });
    expect(Object.keys(siteRatios({ wide: 16 / 9 }))).toEqual(['wide', 'og']);
    expect(siteRatios()).toEqual({ og: 1.91 });
  });

  it('lets a site redefine og', () => {
    expect(siteRatios({ og: 2 })).toEqual({ og: 2 });
  });
});

describe('ratioLabel', () => {
  it('writes small fractions as people do', () => {
    expect(ratioLabel(16 / 9)).toBe('16:9');
    expect(ratioLabel(1)).toBe('1:1');
    expect(ratioLabel(4 / 5)).toBe('4:5');
    expect(ratioLabel(3 / 2)).toBe('3:2');
    expect(ratioLabel(9 / 16)).toBe('9:16');
  });

  it('keeps decimals for anything else', () => {
    expect(ratioLabel(1.91)).toBe('1.91:1');
    expect(ratioLabel(1 / 1.91)).toBe('1:1.91');
  });
});

describe('names and values', () => {
  it('accepts word-like names and positive numbers', () => {
    expect(RATIO_NAME.test('wide')).toBe(true);
    expect(RATIO_NAME.test('card-small')).toBe(true);
    expect(RATIO_NAME.test('16x9')).toBe(false);
    expect(RATIO_NAME.test('')).toBe(false);
    expect(isRatio(1.5)).toBe(true);
    expect(isRatio(0)).toBe(false);
    expect(isRatio(Number.POSITIVE_INFINITY)).toBe(false);
    expect(isRatio('16/9')).toBe(false);
  });
});
