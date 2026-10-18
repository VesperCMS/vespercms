import { describe, expect, it } from 'vitest';
import { applyPatches, diffValues } from './patch.ts';

describe('diffValues', () => {
  it('returns nothing for equal values, including equal dates', () => {
    expect(
      diffValues(
        { a: 1, d: new Date('2026-10-17') },
        { a: 1, d: new Date('2026-10-17T00:00:00Z') },
      ),
    ).toEqual([]);
  });

  it('diffs objects key by key: changed, added and removed keys', () => {
    expect(diffValues({ a: 1, b: 2, c: { x: 1 } }, { a: 1, c: { x: 2 }, d: 4 })).toEqual([
      { op: 'delete', path: ['b'] },
      { op: 'set', path: ['c', 'x'], value: 2 },
      { op: 'set', path: ['d'], value: 4 },
    ]);
  });

  it('treats undefined as absent', () => {
    expect(diffValues({ a: 1, b: 2 }, { a: 1, b: undefined })).toEqual([
      { op: 'delete', path: ['b'] },
    ]);
    expect(diffValues({ a: 1 }, { a: 1, b: undefined })).toEqual([]);
  });

  it('diffs same-length sequences item by item', () => {
    expect(diffValues({ t: ['a', 'b'] }, { t: ['a', 'c'] })).toEqual([
      { op: 'set', path: ['t', 1], value: 'c' },
    ]);
  });

  it('turns appends into push and removals into deletes, highest index first', () => {
    expect(diffValues(['a'], ['a', 'b', 'c'])).toEqual([
      { op: 'push', path: [], value: 'b' },
      { op: 'push', path: [], value: 'c' },
    ]);
    expect(diffValues(['a', 'b', 'c', 'd'], ['a', 'c'])).toEqual([
      { op: 'delete', path: [3] },
      { op: 'delete', path: [1] },
    ]);
  });

  it('replaces a sequence of maps on reorder or insertion in the middle', () => {
    expect(diffValues({ t: [{ a: 1 }, { b: 2 }] }, { t: [{ b: 2 }, { a: 1 }, { c: 3 }] })).toEqual([
      { op: 'set', path: ['t'], value: [{ b: 2 }, { a: 1 }, { c: 3 }] },
    ]);
  });

  it('changes plain values item by item when a list is reordered and resized', () => {
    expect(diffValues({ t: ['a', 'b'] }, { t: ['b', 'a', 'c'] })).toEqual([
      { op: 'set', path: ['t', 0], value: 'b' },
      { op: 'set', path: ['t', 1], value: 'a' },
      { op: 'push', path: ['t'], value: 'c' },
    ]);
    expect(diffValues(['a', 'b', 'c', 'd'], ['d', 'a'])).toEqual([
      { op: 'set', path: [0], value: 'd' },
      { op: 'set', path: [1], value: 'a' },
      { op: 'delete', path: [3] },
      { op: 'delete', path: [2] },
    ]);
    const before = ['a', 'b', 'c', 'd'];
    const after = ['c', 'a', 'x', 'b', 'd'];
    expect(applyPatches(before, diffValues(before, after))).toEqual(after);
  });

  it('replaces the value when its type changes', () => {
    expect(diffValues({ s: 'x' }, { s: { name: 'x' } })).toEqual([
      { op: 'set', path: ['s'], value: { name: 'x' } },
    ]);
  });
});

describe('diffValues: sequences of entries with ids', () => {
  const before = [
    { id: 'a', name: 'A' },
    { id: 'b', name: 'B' },
    { id: 'c', name: 'C' },
  ];

  it('edits one entry and appends another without touching the rest', () => {
    const after = [before[0], { id: 'b', name: 'Bee' }, before[2], { id: 'd', name: 'D' }];
    expect(diffValues(before, after)).toEqual([
      { op: 'set', path: [1, 'name'], value: 'Bee' },
      { op: 'push', path: [], value: { id: 'd', name: 'D' } },
    ]);
  });

  it('removes an entry and edits another, by original index', () => {
    const after = [{ id: 'a', name: 'Ay' }, before[2]];
    const patches = diffValues(before, after);
    expect(patches).toEqual([
      { op: 'set', path: [0, 'name'], value: 'Ay' },
      { op: 'delete', path: [1] },
    ]);
    expect(applyPatches(before, patches)).toEqual(after);
  });

  it('treats an id rename at the same length as a single edit', () => {
    const after = [before[0], { id: 'bee', name: 'B' }, before[2]];
    expect(diffValues(before, after)).toEqual([{ op: 'set', path: [1, 'id'], value: 'bee' }]);
  });
});

describe('applyPatches', () => {
  it.each([
    [
      { a: 1, b: [1, 2, 3], c: { x: 1 } },
      { a: 2, b: [1, 3], c: { y: 2 }, d: ['n'] },
    ],
    [
      [{ id: 'a' }, { id: 'b' }],
      [{ id: 'a' }, { id: 'b', name: 'B' }, { id: 'c' }],
    ],
    [{ list: ['a', 'b', 'c'] }, { list: ['c', 'b'] }],
  ])('applying diffValues(before, after) to before gives after (%#)', (before, after) => {
    expect(applyPatches(before, diffValues(before, after))).toEqual(after);
  });

  it('does not mutate its input', () => {
    const before = { a: [1] };
    applyPatches(before, [{ op: 'push', path: ['a'], value: 2 }]);
    expect(before).toEqual({ a: [1] });
  });
});
