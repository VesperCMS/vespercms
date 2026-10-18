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
 */
export type Patch =
  | { op: 'set'; path: Path; value: DataValue }
  | { op: 'delete'; path: Path }
  | { op: 'push'; path: Path; value: DataValue };

const present = (value: DataValue) => value !== undefined;

/**
 * Diffs two parsed values. Objects are compared key by key. Sequences of the
 * same length are compared item by item. Appending items or removing some (in
 * place) becomes `push`/`delete`. Any other sequence change (inserting in the
 * middle, reordering) compares the items both share by position, then pushes
 * or deletes the rest.
 */
export function diffValues(before: DataValue, after: DataValue, path: Path = []): Patch[] {
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
      else patches.push(...diffValues(prev, next, [...path, key]));
    }
    return patches;
  }

  if (Array.isArray(before) && Array.isArray(after)) {
    const aligned = alignById(before, after, path);
    if (aligned) return aligned;
    if (before.length === after.length) {
      return before.flatMap((item, i) => diffValues(item, after[i], [...path, i]));
    }
    if (after.length > before.length && before.every((item, i) => deepEqual(item, after[i]))) {
      return after.slice(before.length).map((value) => ({ op: 'push', path, value }) as const);
    }
    const removed = removedIndices(before, after);
    if (removed) {
      // Highest index first, so earlier indices stay valid while applying.
      return removed.reverse().map((i) => ({ op: 'delete', path: [...path, i] }) as const);
    }
    // Anything else (reordered, edited and resized at once, like an
    // `_order.yaml` or a redirects list): item by item, then push or delete
    // at the end. Replacing the list whole would re-render it, and at a
    // file's root that loses its comments and its one-line flow maps.
    const shared = Math.min(before.length, after.length);
    const sets = after
      .slice(0, shared)
      .flatMap((item, i) => diffValues(before[i], item, [...path, i]));
    const pushes = after.slice(shared).map((value) => ({ op: 'push', path, value }) as const);
    const deletes = before
      .slice(shared)
      .map((_, i) => ({ op: 'delete', path: [...path, before.length - 1 - i] }) as const);
    return [...sets, ...deletes, ...pushes];
  }

  return [{ op: 'set', path, value: after }];
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
  const edits = after.flatMap((item, i) => {
    const index = position.get(afterIds[i] ?? '');
    return index === undefined ? [] : diffValues(before[index], item, [...path, index]);
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
