import { deepEqual, isPlainObject, type DataValue } from './equal.ts';

export type PathSegment = string | number;
export type Path = readonly PathSegment[];

/**
 * The smallest set of changes that turns one parsed value into another.
 * Serializers apply these to the original text, so a save touches only what
 * changed.
 *
 * - `set`: replace the value at `path`, or add a new map key.
 * - `delete`: remove a map key or a sequence item.
 * - `push`: append to the sequence at `path`.
 * - `order`: rearrange the sequence at `path`: item `j` becomes the item
 *   that was at `order[j]`. Serializers move each item's text as it is.
 *
 * `set`, `delete` and `push` paths are the original value's. `order`
 * patches come after all the others, and their paths and indices are the
 * value's once those are applied; an inner list's come before its outer
 * list's.
 */
export type Patch =
  | { op: 'set'; path: Path; value: DataValue }
  | { op: 'delete'; path: Path }
  | { op: 'push'; path: Path; value: DataValue }
  | { op: 'order'; path: Path; order: number[] };

const present = (value: DataValue) => value !== undefined;

/**
 * Diffs two parsed values. Objects are compared key by key. In a sequence,
 * appending items or removing some (in place) becomes `push`/`delete`, and
 * anything else matches items up: an unchanged item is found wherever it
 * went, and the changed ones are edits of the rest, in order. Items that
 * moved then move as they are, with an `order` patch, so their text moves
 * with them (DECISIONS.md, "A moved list item moves its text as it is").
 * With `moves: false`, sequences compare by position instead: the fallback
 * when a serializer can't move an item's text.
 */
export function diffValues(
  before: DataValue,
  after: DataValue,
  path: Path = [],
  options: { moves?: boolean } = {},
): Patch[] {
  const patches = diff(before, after, path, options.moves !== false);
  return [...patches.filter((p) => p.op !== 'order'), ...patches.filter((p) => p.op === 'order')];
}

function diff(before: DataValue, after: DataValue, path: Path, moves: boolean): Patch[] {
  if (deepEqual(before, after)) return [];

  if (isPlainObject(before) && isPlainObject(after)) {
    const patches: Patch[] = [];
    for (const key of Object.keys(before)) {
      if (present(before[key]) && !present(after[key]))
        patches.push({ op: 'delete', path: [...path, key] });
    }
    for (const key of Object.keys(after)) {
      const next = after[key];
      if (!present(next)) continue;
      const prev = before[key];
      if (!present(prev)) patches.push({ op: 'set', path: [...path, key], value: next });
      else patches.push(...diff(prev, next, [...path, key], moves));
    }
    return patches;
  }

  if (Array.isArray(before) && Array.isArray(after)) {
    const aligned = alignById(before, after, path, moves);
    if (aligned) return aligned;
    if (after.length > before.length && before.every((item, i) => deepEqual(item, after[i]))) {
      return after.slice(before.length).map((value) => ({ op: 'push', path, value }) as const);
    }
    const removed = removedIndices(before, after);
    if (removed) {
      // Highest index first, so earlier indices stay valid while applying.
      return removed.reverse().map((i) => ({ op: 'delete', path: [...path, i] }) as const);
    }
    if (moves) return matchItems(before, after, path);
    if (before.length === after.length) {
      return before.flatMap((item, i) => diff(item, after[i], [...path, i], false));
    }
    // Reordered, or edited and resized at once, compared by position: item by
    // item, then push or delete at the end. Replacing the list whole would
    // re-render it, and at a file's root that loses its comments and its
    // one-line flow maps.
    const shared = Math.min(before.length, after.length);
    const sets = after
      .slice(0, shared)
      .flatMap((item, i) => diff(before[i], item, [...path, i], false));
    const pushes = after.slice(shared).map((value) => ({ op: 'push', path, value }) as const);
    const deletes = before
      .slice(shared)
      .map((_, i) => ({ op: 'delete', path: [...path, before.length - 1 - i] }) as const);
    return [...sets, ...deletes, ...pushes];
  }

  return [{ op: 'set', path, value: after }];
}

/** An inner list's `order` patch, at the index its outer item has once removals are done. */
function shifted(patch: Patch, at: number, index: number): Patch {
  if (patch.op !== 'order') return patch;
  return { ...patch, path: patch.path.map((segment, i) => (i === at ? index : segment)) };
}

/** How much of `b` is already in `a`, from 0 to 1: equal values, matching keys, list items found. */
function likeness(a: DataValue, b: DataValue): number {
  if (deepEqual(a, b)) return 1;
  if (isPlainObject(a) && isPlainObject(b)) {
    const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter(
      (key) => present(a[key]) || present(b[key]),
    );
    if (keys.length === 0) return 1;
    return keys.reduce((sum, key) => sum + likeness(a[key], b[key]), 0) / keys.length;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    const left = [...a];
    let found = 0;
    for (const item of b) {
      const at = left.findIndex((other) => deepEqual(other, item));
      if (at !== -1) {
        left.splice(at, 1);
        found++;
      }
    }
    return found / Math.max(a.length, b.length, 1);
  }
  return 0;
}

/**
 * Matches a sequence's items: unchanged ones in place, then unchanged ones
 * wherever they went, then each changed one as an edit of the unused old
 * item it most resembles. Old items left over are deleted, new ones pushed,
 * and an `order` patch moves them all where they belong.
 */
function matchItems(
  before: readonly DataValue[],
  after: readonly DataValue[],
  path: Path,
): Patch[] {
  const source: number[] = after.map(() => -1);
  const used = new Set<number>();
  after.forEach((item, j) => {
    if (j < before.length && deepEqual(before[j], item)) {
      source[j] = j;
      used.add(j);
    }
  });
  after.forEach((item, j) => {
    if (source[j] !== -1) return;
    const i = before.findIndex((old, at) => !used.has(at) && deepEqual(old, item));
    if (i !== -1) {
      source[j] = i;
      used.add(i);
    }
  });
  // A changed item is an edit of the old one it most resembles: removing one
  // item and editing another in the same save then edits the right one.
  const unused = new Set(before.map((_, i) => i).filter((i) => !used.has(i)));
  after.forEach((item, j) => {
    if (source[j] !== -1 || unused.size === 0) return;
    let best = -1;
    let score = -1;
    for (const i of unused) {
      const like = likeness(before[i], item);
      if (like > score) {
        best = i;
        score = like;
      }
    }
    source[j] = best;
    unused.delete(best);
  });
  const deleted = unused;
  const kept = before.map((_, i) => i).filter((i) => !deleted.has(i));
  const position = new Map(kept.map((i, at) => [i, at]));

  const edits: Patch[] = [];
  const inner: Patch[] = [];
  after.forEach((item, j) => {
    const i = source[j] ?? -1;
    if (i === -1) return;
    for (const patch of diff(before[i], item, [...path, i], true)) {
      if (patch.op === 'order') inner.push(shifted(patch, path.length, position.get(i) ?? i));
      else edits.push(patch);
    }
  });
  const deletes = [...deleted]
    .sort((a, b) => b - a)
    .map((i) => ({ op: 'delete', path: [...path, i] }) as const);
  const added = after.map((_, j) => j).filter((j) => source[j] === -1);
  const pushes = added.map((j) => ({ op: 'push', path, value: after[j] }) as const);
  // Once those are applied, the list holds the kept items in their old order, then the new ones.
  const order = after.map((_, j) => {
    const i = source[j] ?? -1;
    return i === -1 ? kept.length + added.indexOf(j) : (position.get(i) ?? j);
  });
  const moved = order.some((at, j) => at !== j);
  return [
    ...edits,
    ...deletes,
    ...pushes,
    ...inner,
    ...(moved ? [{ op: 'order', path, order } as const] : []),
  ];
}

const identityOf = (item: DataValue): string | null => {
  if (!isPlainObject(item)) return null;
  const id = item.id ?? item.slug;
  return typeof id === 'string' || typeof id === 'number' ? String(id) : null;
};

/**
 * Sequences whose items all carry an `id` (or `slug`), like `file()` loader
 * data, are matched item by item even when the length changes. Editing one
 * entry, removing another and appending a third touches only those three.
 * The patches use the original indices: item edits first, then removals
 * (highest index first), then appends. Applying them in order is safe.
 *
 * Returns `null` (positional diffing applies) when the length is unchanged,
 * or unless every item has a unique identity and the kept items stay in
 * their original order, with new items only at the end.
 */
function alignById(
  before: readonly DataValue[],
  after: readonly DataValue[],
  path: Path,
  moves: boolean,
): Patch[] | null {
  if (before.length === 0 || after.length === 0) return null;
  const beforeIds = before.map(identityOf);
  const afterIds = after.map(identityOf);
  if (beforeIds.includes(null) || afterIds.includes(null)) return null;
  if (new Set(beforeIds).size !== beforeIds.length || new Set(afterIds).size !== afterIds.length)
    return null;
  // Same length: positional diffing is exact, and it is what makes an id rename a single edit.
  if (before.length === after.length) return null;

  const position = new Map(beforeIds.map((id, i) => [id, i]));
  let lastKept = -1;
  let seenNew = false;
  for (const id of afterIds) {
    const index = position.get(id);
    if (index === undefined) {
      seenNew = true;
    } else {
      if (seenNew || index < lastKept) return null;
      lastKept = index;
    }
  }

  const kept = new Set(afterIds);
  // An inner list's moves happen once removals are done, when fewer items come before it.
  const removedBefore = (index: number) =>
    beforeIds.slice(0, index).filter((id) => !kept.has(id)).length;
  const edits = after.flatMap((item, i) => {
    const index = position.get(afterIds[i] ?? '');
    return index === undefined
      ? []
      : diff(before[index], item, [...path, index], moves).map((patch) =>
          shifted(patch, path.length, index - removedBefore(index)),
        );
  });
  const removals = beforeIds
    .map((id, i) => (kept.has(id) ? -1 : i))
    .filter((i) => i >= 0)
    .reverse()
    .map((i) => ({ op: 'delete', path: [...path, i] }) as const);
  const appends = after
    .filter((_, i) => !position.has(afterIds[i] ?? ''))
    .map((value) => ({ op: 'push', path, value }) as const);
  return [...edits, ...removals, ...appends];
}

/** Indices removed from `before` to get `after`, if `after` is `before` with only removals. */
function removedIndices(
  before: readonly DataValue[],
  after: readonly DataValue[],
): number[] | null {
  if (after.length >= before.length) return null;
  const removed: number[] = [];
  let j = 0;
  for (let i = 0; i < before.length; i++) {
    if (j < after.length && deepEqual(before[i], after[j])) j++;
    else removed.push(i);
  }
  return j === after.length ? removed : null;
}

/** Applies patches to a plain value (no text involved). Used to compute expected results. */
export function applyPatches(value: DataValue, patches: readonly Patch[]): DataValue {
  let result = structuredClone(value);
  for (const patch of patches) result = applyOne(result, patch);
  return result;
}

function applyOne(root: DataValue, patch: Patch): DataValue {
  if (patch.op === 'order') {
    const list = getAt(root, patch.path);
    if (!Array.isArray(list)) throw new Error(`Not a sequence at ${patch.path.join('.')}`);
    const reordered = patch.order.map((i) => list[i]);
    list.splice(0, list.length, ...reordered);
    return root;
  }
  if (patch.path.length === 0) {
    if (patch.op === 'set') return structuredClone(patch.value);
    if (patch.op === 'push' && Array.isArray(root)) return [...root, structuredClone(patch.value)];
    throw new Error(`Can't ${patch.op} at the root`);
  }
  const parent = getAt(root, patch.path.slice(0, -1));
  const key = patch.path.at(-1);
  if (patch.op === 'push') {
    const target = getAt(root, patch.path);
    if (!Array.isArray(target)) throw new Error(`Not a sequence at ${patch.path.join('.')}`);
    target.push(structuredClone(patch.value));
  } else if (Array.isArray(parent) && typeof key === 'number') {
    if (patch.op === 'delete') parent.splice(key, 1);
    else parent[key] = structuredClone(patch.value);
  } else if (isPlainObject(parent) && typeof key === 'string') {
    if (patch.op === 'delete') Reflect.deleteProperty(parent, key);
    else parent[key] = structuredClone(patch.value);
  } else {
    throw new Error(`No container at ${patch.path.join('.')}`);
  }
  return root;
}

export function getAt(root: DataValue, path: Path): DataValue {
  let node: DataValue = root;
  for (const segment of path) {
    if (Array.isArray(node) && typeof segment === 'number') node = node[segment];
    else if (isPlainObject(node) && typeof segment === 'string') node = node[segment];
    else return undefined;
  }
  return node;
}
