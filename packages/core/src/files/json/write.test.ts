import { describe, expect, it } from 'vitest';
import type { DataValue } from '../equal.ts';
import { readJson, writeJson } from './write.ts';

function edit(text: string, change: (value: Record<string, DataValue>) => void): string {
  const read = readJson(text);
  if (!read.editable) throw new Error('not editable');
  const value = structuredClone(read.value) as Record<string, DataValue>;
  change(value);
  return writeJson(text, value).text;
}

describe('writeJson', () => {
  it('changes one value and leaves the rest byte-identical', () => {
    expect(edit('{\n  "title": "Old",\n  "count": 2\n}\n', (v) => (v.title = 'New'))).toBe(
      '{\n  "title": "New",\n  "count": 2\n}\n',
    );
  });

  it('adds a key with the file’s indentation: 4 spaces, tabs, CRLF', () => {
    expect(edit('{\n    "a": 1\n}\n', (v) => (v.b = 2))).toBe('{\n    "a": 1,\n    "b": 2\n}\n');
    expect(edit('{\n\t"a": 1\n}\n', (v) => (v.b = 2))).toBe('{\n\t"a": 1,\n\t"b": 2\n}\n');
    expect(edit('{\r\n  "a": 1\r\n}\r\n', (v) => (v.b = 2))).toBe(
      '{\r\n  "a": 1,\r\n  "b": 2\r\n}\r\n',
    );
  });

  it('deletes a key and appends to an array', () => {
    expect(edit('{\n  "a": 1,\n  "b": 2\n}\n', (v) => delete v.a)).toBe('{\n  "b": 2\n}\n');
    expect(edit('{\n  "tags": ["a", "b"]\n}\n', (v) => (v.tags as DataValue[]).push('c'))).toBe(
      '{\n  "tags": ["a", "b", "c"]\n}\n',
    );
  });

  it('appends to a multi-line array without touching the items already there', () => {
    // A file() collection of one-line items: the new item is one line too.
    expect(
      writeJson('[\n  { "id": "a", "n": 1 },\n  { "id": "b", "n": 2 }\n]\n', [
        { id: 'a', n: 1 },
        { id: 'b', n: 2 },
        { id: 'c', n: 3, tags: ['x'] },
      ]).text,
    ).toBe(
      '[\n  { "id": "a", "n": 1 },\n  { "id": "b", "n": 2 },\n  { "id": "c", "n": 3, "tags": ["x"] }\n]\n',
    );
    // Items over several lines: the new item is indented the same way.
    expect(
      writeJson('{\r\n  "list": [\r\n    {\r\n      "id": "a"\r\n    }\r\n  ]\r\n}\r\n', {
        list: [{ id: 'a' }, { id: 'b' }],
      }).text,
    ).toBe(
      '{\r\n  "list": [\r\n    {\r\n      "id": "a"\r\n    },\r\n    {\r\n      "id": "b"\r\n    }\r\n  ]\r\n}\r\n',
    );
  });

  it('keeps a file without a final newline that way, and keeps minified files minified', () => {
    expect(edit('{\n  "a": 1\n}', (v) => (v.a = 2))).toBe('{\n  "a": 2\n}');
    expect(edit('{"a":1,"b":[1,2]}\n', (v) => (v.a = 5))).toBe('{"a":5,"b":[1,2]}\n');
  });

  it('moves an item’s text as it is, in multi-line and one-line arrays', () => {
    const pretty = '[\n  {\n    "id": "a",\n    "note": "x"\n  },\n  { "id": "b" }\n]\n';
    const read = readJson(pretty);
    if (!read.editable) throw new Error('not editable');
    const swapped = [...(read.value as DataValue[])].reverse();
    expect(writeJson(pretty, swapped).text).toBe(
      '[\n  { "id": "b" },\n  {\n    "id": "a",\n    "note": "x"\n  }\n]\n',
    );
    expect(edit('{"t":["a", "b",  "c"]}', (v) => (v.t = ['c', 'a', 'b']))).toBe(
      '{"t":["c", "a",  "b"]}',
    );
  });

  it('returns the input unchanged when nothing changed', () => {
    const text = '{ "odd" :   1 }';
    expect(writeJson(text, { odd: 1 })).toEqual({ text, changed: false });
  });

  it('is source-only for invalid JSON and duplicate keys', () => {
    expect(readJson('{ nope')).toMatchObject({ editable: false, reason: 'json-error' });
    expect(readJson('{ "a": 1, "a": 2 }')).toMatchObject({
      editable: false,
      reason: 'duplicate-keys',
    });
  });
});
