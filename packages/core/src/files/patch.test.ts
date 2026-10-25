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

  it('compares maps by position when a list is edited and grows', () => {
    expect(diffValues({ t: [{ a: 1 }, { a: 2 }] }, { t: [{ a: 9 }, { a: 2 }, { a: 3 }] })).toEqual([
      { op: 'set', path: ['t', 0, 'a'], value: 9 },
      { op: 'push', path: ['t'], value: { a: 3 } },
    ]);
  });

  it('moves items that moved, so their text can move as it is', () => {
    expect(diffValues({ t: ['a', 'b'] }, { t: ['b', 'a', 'c'] })).toEqual([
      { op: 'push', path: ['t'], value: 'c' },
      { op: 'order', path: ['t'], order: [1, 0, 2] },
    ]);
    expect(diffValues(['a', 'b', 'c', 'd'], ['d', 'a'])).toEqual([
      { op: 'delete', path: [2] },
      { op: 'delete', path: [1] },
      { op: 'order', path: [], order: [1, 0] },
    ]);
    // A moved item that was also edited: the edit at its old place, then the move.
    expect(diffValues([{ h: 'A' }, { h: 'B' }], [{ h: 'B' }, { h: 'A!' }])).toEqual([
      { op: 'set', path: [0, 'h'], value: 'A!' },
      { op: 'order', path: [], order: [1, 0] },
    ]);
    // A new item added in the middle is pushed, then moved there.
    expect(diffValues(['a', 'b'], ['a', 'x', 'b'])).toEqual([
      { op: 'push', path: [], value: 'x' },
      { op: 'order', path: [], order: [0, 2, 1] },
    ]);
    for (const [before, after] of [
      [
        ['a', 'b', 'c', 'd'],
        ['c', 'a', 'x', 'b', 'd'],
      ],
      [
        ['a', 'b', 'c'],
        ['c', 'b', 'a'],
      ],
      [
        [1, 2, 3, 4, 5],
        [5, 9, 1],
      ],
    ] as const) {
      expect(applyPatches([...before], diffValues([...before], [...after]))).toEqual(after);
    }
  });

  it('moves an inner list’s items at the index its outer item has once removals are done', () => {
    const before = { s: [{ p: [1] }, { p: [2, 3] }, { p: [4] }] };
    const after = { s: [{ p: [3, 2] }, { p: [4] }] };
    const patches = diffValues(before, after);
    expect(patches).toEqual([
      { op: 'delete', path: ['s', 0] },
      { op: 'order', path: ['s', 0, 'p'], order: [1, 0] },
    ]);
    expect(applyPatches(before, patches)).toEqual(after);
  });

  it('edits the item a changed one most resembles, when another was removed in the same save', () => {
    const before = [
      { heading: 'Clubs', body: 'Forty of them.' },
      { heading: 'Sports', body: 'Every season.' },
      { heading: 'Arts', body: 'Open late.' },
    ];
    const after = [
      { heading: 'Sports', body: 'Every season, all year.' },
      { heading: 'Arts', body: 'Open late.' },
    ];
    expect(diffValues(before, after)).toEqual([
      { op: 'set', path: [1, 'body'], value: 'Every season, all year.' },
      { op: 'delete', path: [0] },
    ]);
  });

  it('compares by position with moves off, as writers do when items can’t move', () => {
    expect(diffValues({ t: ['a', 'b'] }, { t: ['b', 'a', 'c'] }, [], { moves: false })).toEqual([
      { op: 'set', path: ['t', 0], value: 'b' },
      { op: 'set', path: ['t', 1], value: 'a' },
      { op: 'push', path: ['t'], value: 'c' },
    ]);
    const before = ['a', 'b', 'c', 'd'];
    const after = ['c', 'a', 'x', 'b', 'd'];
    expect(applyPatches(before, diffValues(before, after, [], { moves: false }))).toEqual(after);
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
