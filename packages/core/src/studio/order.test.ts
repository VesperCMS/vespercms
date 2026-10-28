import { describe, expect, it } from 'vitest';
import { compareOrder, placeAfter, type OrderedEntry } from './order.ts';

const entries = (values: Record<string, number | undefined>): OrderedEntry[] =>
  Object.entries(values).map(([id, value]) => ({ id, title: id, value }));

/** thosegeeks.com's services, numbered by hand. */
const services = entries({
  design: 0,
  wordpress: 10,
  ecommerce: 20,
  marketing: 30,
  support: 60,
  custom: 90,
  cannabis: 420,
});

const ids = (order: OrderedEntry[]) => order.map((entry) => entry.id);

describe('compareOrder', () => {
  it('puts the lowest number first, entries without one last, and ties by title', () => {
    const sorted = entries({ c: 3, none: undefined, b: 3, a: 1 }).sort(compareOrder);
    expect(ids(sorted)).toEqual(['a', 'b', 'c', 'none']);
  });
});

describe('placeAfter', () => {
  it('writes only the moved entry, halfway between its new neighbours', () => {
    const plan = placeAfter(services, 'cannabis', 'wordpress');
    expect(plan?.changes).toEqual([{ id: 'cannabis', value: 15 }]);
    expect(plan?.index).toBe(2);
    expect(ids(plan?.order ?? [])).toEqual([
      'design',
      'wordpress',
      'cannabis',
      'ecommerce',
      'marketing',
      'support',
      'custom',
    ]);
  });

  it('goes below the first entry without going under 0', () => {
    expect(placeAfter(services, 'support', null)?.changes).toEqual([
      // 0 leaves no room above it, so the entries from there down move up one.
      { id: 'support', value: 0 },
      { id: 'design', value: 1 },
    ]);
    const quotes = entries({ jody: 1, alan: 3, lyndsey: 4, rebecca: 5, jill: 7 });
    expect(placeAfter(quotes, 'jill', null)?.changes).toEqual([{ id: 'jill', value: 0 }]);
    expect(placeAfter(entries({ a: 20, b: 30 }), 'b', null)?.changes).toEqual([
      { id: 'b', value: 10 },
    ]);
  });

  it('goes past the last entry with room to spare', () => {
    expect(placeAfter(services, 'design', 'cannabis')?.changes).toEqual([
      { id: 'design', value: 430 },
    ]);
  });

  it('moves the entries below up one when neighbours leave no room', () => {
    // The playground's docs: two share 3.
    const docs = entries({ start: 1, callouts: 2, conditional: 3, hours: 3 });
    const plan = placeAfter(docs, 'hours', 'callouts');
    expect(plan?.changes).toEqual([
      { id: 'hours', value: 3 },
      { id: 'conditional', value: 4 },
    ]);
    expect(ids(plan?.order ?? [])).toEqual(['start', 'callouts', 'hours', 'conditional']);
    // The new numbers sort the same way the plan says.
    const after = docs.map((entry) => ({
      ...entry,
      value: plan?.changes.find((c) => c.id === entry.id)?.value ?? entry.value,
    }));
    expect(ids(after.sort(compareOrder))).toEqual(ids(plan?.order ?? []));
  });

  it('numbers entries that had none when one is placed after them', () => {
    const list = entries({ a: 1, b: undefined, c: undefined });
    expect(placeAfter(list, 'a', 'b')?.changes).toEqual([
      { id: 'b', value: 0 },
      { id: 'a', value: 1 },
    ]);
    // Placed among them at the top, it alone needs a number.
    expect(placeAfter(entries({ b: undefined, c: undefined }), 'c', null)?.changes).toEqual([
      { id: 'c', value: 10 },
    ]);
  });

  it('writes nothing when the entry is already there', () => {
    expect(placeAfter(services, 'ecommerce', 'wordpress')?.changes).toEqual([]);
    expect(placeAfter(services, 'design', null)?.changes).toEqual([]);
  });

  it('says the list was out of date when an entry is missing', () => {
    expect(placeAfter(services, 'gone', null)).toBeNull();
    expect(placeAfter(services, 'design', 'gone')).toBeNull();
    expect(placeAfter(services, 'design', 'design')).toBeNull();
  });
});
