import {
  applyEdits,
  findNodeAtLocation,
  modify,
  parseTree,
  type Edit,
  type FormattingOptions,
  type Node as JsonNode,
} from 'jsonc-parser';
import { deepEqual, type DataValue } from '../equal.ts';
import { SerializationError } from '../errors.ts';
import { diffValues } from '../patch.ts';
import { lineEndings } from '../text.ts';

export type JsonRead =
  | { editable: true; value: DataValue }
  | { editable: false; reason: 'json-error' | 'duplicate-keys'; message: string; value: DataValue };

/**
 * Reads JSON the way Astro does (`JSON.parse`). Files with duplicate keys
 * are source-only: `JSON.parse` silently keeps the last one, so an editor
 * showing either value would be lying about the other.
 */
export function readJson(text: string): JsonRead {
  let value: DataValue;
  try {
    value = JSON.parse(text) as DataValue;
  } catch (error) {
    return {
      editable: false,
      reason: 'json-error',
      message: (error as Error).message,
      value: undefined,
    };
  }
  const tree = parseTree(text);
  if (tree && hasDuplicateKeys(tree)) {
    return {
      editable: false,
      reason: 'duplicate-keys',
      message: 'This file repeats a key, so only one of the values is used.',
      value,
    };
  }
  return { editable: true, value };
}

function hasDuplicateKeys(node: JsonNode): boolean {
  if (node.type === 'object') {
    const keys = new Set<string>();
    for (const property of node.children ?? []) {
      const key = property.children?.[0]?.value as string | undefined;
      if (key !== undefined) {
        if (keys.has(key)) return true;
        keys.add(key);
      }
    }
  }
  return (node.children ?? []).some(hasDuplicateKeys);
}

/**
 * Appending to a one-line array: jsonc-parser would reformat the whole array
 * onto separate lines, so the item is spliced in before the `]` instead.
 */
function inlineAppend(text: string, path: (string | number)[], value: DataValue): Edit[] | null {
  const tree = parseTree(text);
  const array = tree && findNodeAtLocation(tree, path);
  if (array?.type !== 'array') return null;
  const source = text.slice(array.offset, array.offset + array.length);
  if (source.includes('\n')) return null;
  const last = array.children?.at(-1);
  const item = JSON.stringify(value);
  if (!last) return [{ offset: array.offset + 1, length: 0, content: item }];
  return [{ offset: last.offset + last.length, length: 0, content: `, ${item}` }];
}

/**
 * Appending to an array whose last item starts its own line: jsonc-parser
 * would reformat that item along with the new one, so the new item is
 * spliced in after it, on its own line at the same indent. It copies the
 * last item's shape: one line (`{ "id": "a", "name": "A" }`, spaced or
 * not) or indented over several lines.
 */
function blockAppend(
  text: string,
  path: (string | number)[],
  value: DataValue,
  options: FormattingOptions,
): Edit[] | null {
  const tree = parseTree(text);
  const array = tree && findNodeAtLocation(tree, path);
  const last = array?.type === 'array' ? array.children?.at(-1) : undefined;
  if (!last) return null;
  const lineStart = text.lastIndexOf('\n', last.offset) + 1;
  const before = text.slice(lineStart, last.offset);
  if (before.trim() !== '') return null;
  const source = text.slice(last.offset, last.offset + last.length);
  const eol = options.eol ?? '\n';
  let item: string;
  if (source.includes('\n')) {
    const unit = options.insertSpaces === false ? '\t' : ' '.repeat(options.tabSize ?? 2);
    item = JSON.stringify(value, null, unit).split('\n').join(`${eol}${before}`);
  } else {
    item = inlineJson(value, /^[{[]\s|:\s|,\s/.test(source));
  }
  return [{ offset: last.offset + last.length, length: 0, content: `,${eol}${before}${item}` }];
}

/** One-line JSON, with `{ "a": 1, "b": 2 }` spacing or `{"a":1,"b":2}`. */
function inlineJson(value: DataValue, spaced: boolean): string {
  if (Array.isArray(value)) {
    const items = value.map((v) => inlineJson(v, spaced));
    if (items.length === 0) return '[]';
    return spaced ? `[${items.join(', ')}]` : `[${items.join(',')}]`;
  }
  if (typeof value === 'object' && value !== null && !(value instanceof Date)) {
    const entries = Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => `${JSON.stringify(k)}:${spaced ? ' ' : ''}${inlineJson(v, spaced)}`);
    if (entries.length === 0) return '{}';
    return spaced ? `{ ${entries.join(', ')} }` : `{${entries.join(',')}}`;
  }
  return JSON.stringify(value);
}

/** Indentation and line endings as the file already uses them. */
export function detectJsonFormatting(text: string): FormattingOptions {
  const indented = /\n([ \t]+)\S/.exec(text);
  const indent = indented?.[1] ?? '  ';
  return {
    insertSpaces: !indent.startsWith('\t'),
    tabSize: indent.startsWith('\t') ? 1 : indent.length,
    eol: lineEndings(text).dominant,
    insertFinalNewline: false,
    keepLines: true,
  };
}

export type JsonWriteResult = { text: string; changed: boolean };

/**
 * Writes `next` into JSON text, changing only what differs. It uses
 * jsonc-parser's formatting-preserving edits, so untouched properties keep
 * their exact spacing and order. The result is re-parsed and compared with
 * `next` before it is returned; any mismatch throws instead.
 */
export function writeJson(text: string, next: DataValue): JsonWriteResult {
  const read = readJson(text);
  if (!read.editable) throw new SerializationError('source-only', read.message);
  const patches = diffValues(read.value, next);
  if (patches.length === 0) return { text, changed: false };

  const formattingOptions = detectJsonFormatting(text);
  let out = text;
  for (const patch of patches) {
    const path = [...patch.path];
    const edits =
      patch.op === 'push'
        ? (inlineAppend(out, path, patch.value) ??
          blockAppend(out, path, patch.value, formattingOptions) ??
          modify(out, [...path, -1], patch.value, { formattingOptions, isArrayInsertion: true }))
        : modify(out, path, patch.op === 'delete' ? undefined : patch.value, { formattingOptions });
    out = applyEdits(out, edits);
  }

  const reread = readJson(out);
  if (!reread.editable || !deepEqual(reread.value, next)) {
    throw new SerializationError(
      'verification-failed',
      "This change couldn't be saved without altering other content, so nothing was saved.",
    );
  }
  return { text: out, changed: true };
}
