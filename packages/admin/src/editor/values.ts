import { isPlainObject, type DataObject, type DataValue, type FieldModel } from '@vesper/core';

/** A concrete path into an entry's values: keys and array indexes. */
export type ValuePath = readonly (string | number)[];

export function getIn(root: DataValue, path: ValuePath): DataValue {
  let current: DataValue = root;
  for (const segment of path) {
    if (typeof segment === 'number') {
      current = Array.isArray(current) ? current[segment] : undefined;
    } else {
      current = isPlainObject(current) ? current[segment] : undefined;
    }
    if (current === undefined) return undefined;
  }
  return current;
}

/**
 * Returns a copy of `root` with the value at `path` replaced. `undefined`
 * removes an object key (the file then loses that line) and leaves array
 * items in place. Missing parents are created.
 */
export function setIn(root: DataObject, path: ValuePath, value: DataValue): DataObject {
  return setAt(root, path, 0, value) as DataObject;
}

function setAt(node: DataValue, path: ValuePath, index: number, value: DataValue): DataValue {
  if (index === path.length) return value;
  const segment = path[index] as string | number;
  if (typeof segment === 'number') {
    const list = Array.isArray(node) ? [...node] : [];
    list[segment] = setAt(list[segment], path, index + 1, value);
    return list;
  }
  const object: DataObject = isPlainObject(node) ? { ...node } : {};
  const next = setAt(object[segment], path, index + 1, value);
  if (next === undefined) Reflect.deleteProperty(object, segment);
  else object[segment] = next;
  return object;
}

/** A DOM id for the control at `path`: stable, unique per entry, and safe in selectors. */
export function fieldId(path: ValuePath): string {
  return `field-${path.map((s) => String(s).replace(/[^A-Za-z0-9_-]/g, '_')).join('-')}`;
}

/** Key for matching validation issues to fields. */
export function pathKey(path: ValuePath): string {
  return path.map(String).join('.');
}

/** A field model's own key: the last segment of its path (`'[]'` for array items). */
export function keyOf(field: FieldModel): string {
  return field.path.at(-1) ?? '';
}

/** The value a new entry starts with: each field's static default, where it has one. */
export function initialValues(fields: readonly FieldModel[] | null): DataObject {
  const values: DataObject = {};
  for (const field of fields ?? []) {
    if (field.default !== undefined && !field.defaultDynamic) {
      values[keyOf(field)] = structuredClone(field.default) as DataValue;
    }
  }
  return values;
}
