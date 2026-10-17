import { isPlainObject, type DataValue } from './equal.ts';
import { SerializationError } from './errors.ts';
import type { FileWriteResult } from './entry-file.ts';
import { readJson, writeJson } from './json/write.ts';
import { decodeUtf8, encodeUtf8 } from './text.ts';
import { readYaml } from './yaml/read.ts';
import { writeYaml } from './yaml/write.ts';

export type DataFormat = 'json' | 'yaml';

/** The data format of a path, as Astro decides it (by extension). TOML is read-only in v1. */
export function dataFormatOf(path: string): DataFormat | 'toml' | null {
  const ext = path.split('.').at(-1)?.toLowerCase();
  if (ext === 'json') return 'json';
  if (ext === 'yaml' || ext === 'yml') return 'yaml';
  if (ext === 'toml') return 'toml';
  return null;
}

export type DataFile =
  | { status: 'editable'; value: DataValue }
  | { status: 'source-only' | 'read-only'; message: string; value: DataValue };

export function readDataFile(bytes: Uint8Array, format: DataFormat): DataFile {
  const text = decodeUtf8(bytes);
  if (text === null) {
    return {
      status: 'read-only',
      message: "This file isn't UTF-8 text, so it can't be edited safely.",
      value: undefined,
    };
  }
  if (format === 'json') {
    const read = readJson(text);
    return read.editable
      ? { status: 'editable', value: read.value }
      : { status: 'source-only', message: read.message, value: read.value };
  }
  const read = readYaml(text, 'any');
  return read.editable
    ? { status: 'editable', value: read.value }
    : { status: 'source-only', message: read.message, value: read.value };
}

/** Writes a whole data file (a `glob()` data entry, or a `file()` collection's file). */
export function writeDataFile(
  bytes: Uint8Array,
  format: DataFormat,
  next: DataValue,
): FileWriteResult {
  const text = decodeUtf8(bytes);
  if (text === null)
    throw new SerializationError(
      'unsupported',
      "This file isn't UTF-8 text, so it can't be edited safely.",
    );
  const result =
    format === 'json'
      ? { ...writeJson(text, next), reformatted: false }
      : writeYaml(text, next, { expect: 'any' });
  return {
    bytes: result.changed ? encodeUtf8(result.text) : bytes,
    changed: result.changed,
    reformatted: result.reformatted,
  };
}

// ---------------------------------------------------------------------------
// file() loader collections: many entries in one file (Astro's file loader).
// ---------------------------------------------------------------------------

export type CollectionFileEntry = { id: string; data: DataValue };

export type CollectionFile =
  | {
      status: 'editable';
      shape: 'array' | 'object';
      entries: CollectionFileEntry[];
      value: DataValue;
    }
  | { status: 'source-only' | 'read-only'; message: string };

/** An array item's id, as Astro's file loader computes it: `(item.id ?? item.slug).toString()`. */
function entryIdOf(item: DataValue): string | null {
  if (!isPlainObject(item)) return null;
  const id = item.id ?? item.slug;
  if (typeof id === 'string') return id;
  if (typeof id === 'number' || typeof id === 'boolean') return String(id);
  return null;
}

/**
 * Lists a `file()` collection's entries the way Astro's file loader does:
 * - an array of items, each identified by its `id` (or `slug`);
 * - or an object keyed by id, skipping a string `$schema` key.
 * For arrays, `data` includes the `id` field itself, as Astro passes it.
 */
export function readCollectionFile(bytes: Uint8Array, format: DataFormat): CollectionFile {
  const file = readDataFile(bytes, format);
  if (file.status !== 'editable') return { status: file.status, message: file.message };
  const { value } = file;
  if (Array.isArray(value)) {
    const entries = value.flatMap((item): CollectionFileEntry[] => {
      const id = entryIdOf(item);
      return id === null ? [] : [{ id, data: item }];
    });
    return { status: 'editable', shape: 'array', entries, value };
  }
  if (isPlainObject(value)) {
    const entries = Object.entries(value)
      .filter(([key, item]) => !(key === '$schema' && typeof item === 'string'))
      .map(([id, data]) => ({ id, data }));
    return { status: 'editable', shape: 'object', entries, value };
  }
  return {
    status: 'source-only',
    message: 'This data file must hold a list or a set of named entries.',
  };
}

/**
 * Writes one entry of a `file()` collection: updates it in place, appends it
 * if it's new, or removes it when `data` is `null`. The entry is found by id
 * at write time, never by a cached position, so concurrent edits to other
 * entries can't shift it.
 */
export function writeCollectionEntry(
  bytes: Uint8Array,
  format: DataFormat,
  id: string,
  data: DataValue | null,
): FileWriteResult {
  const file = readCollectionFile(bytes, format);
  if (file.status !== 'editable') throw new SerializationError('source-only', file.message);

  let next: DataValue;
  if (file.shape === 'array') {
    const items = structuredClone(file.value) as DataValue[];
    const index = items.findIndex((item) => entryIdOf(item) === id);
    if (data === null) {
      if (index === -1) throw new SerializationError('unsupported', `No entry "${id}" to remove.`);
      items.splice(index, 1);
    } else if (index === -1) {
      items.push(data);
    } else {
      items[index] = data;
    }
    next = items;
  } else {
    const object = structuredClone(file.value) as Record<string, DataValue>;
    if (data === null) {
      if (!Object.hasOwn(object, id))
        throw new SerializationError('unsupported', `No entry "${id}" to remove.`);
      Reflect.deleteProperty(object, id);
    } else {
      object[id] = data;
    }
    next = object;
  }
  return writeDataFile(bytes, format, next);
}
