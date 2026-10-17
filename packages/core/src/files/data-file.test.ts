import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  dataFormatOf,
  readCollectionFile,
  writeCollectionEntry,
  writeDataFile,
} from './data-file.ts';
import { decodeUtf8 } from './text.ts';

const fixture = (name: string) =>
  new Uint8Array(readFileSync(new URL(`../../test/fixtures/data/${name}`, import.meta.url)));
const textOf = (data: Uint8Array) => decodeUtf8(data) ?? '';

describe('dataFormatOf', () => {
  it('decides by extension, as Astro does', () => {
    expect(['a.json', 'a.yaml', 'a.YML', 'a.toml', 'a.md'].map(dataFormatOf)).toEqual([
      'json',
      'yaml',
      'yaml',
      'toml',
      null,
    ]);
  });
});

describe('readCollectionFile', () => {
  it('lists array entries by id, keeping the id in the data', () => {
    const file = readCollectionFile(fixture('file-loader-array.json'), 'json');
    expect(file).toMatchObject({
      status: 'editable',
      shape: 'array',
      entries: [
        { id: 'ada', data: { id: 'ada', name: 'Ada' } },
        { id: 'sam', data: { id: 'sam', name: 'Sam', role: 'Writer' } },
      ],
    });
  });

  it('lists object entries by key and skips a $schema string', () => {
    const file = readCollectionFile(fixture('file-loader-object.json'), 'json');
    expect(file.status === 'editable' && file.entries.map((e) => e.id)).toEqual(['ada', 'sam']);
  });
});

describe('writeCollectionEntry', () => {
  it('updates one array entry in place, leaving the others byte-identical', () => {
    const result = writeCollectionEntry(fixture('file-loader-array.json'), 'json', 'sam', {
      id: 'sam',
      name: 'Sam',
      role: 'Editor',
    });
    expect(textOf(result.bytes)).toBe(
      '[\n  { "id": "ada", "name": "Ada" },\n  {\n    "id": "sam",\n    "name": "Sam",\n    "role": "Editor"\n  }\n]\n',
    );
  });

  it('appends a new entry and removes one, in YAML', () => {
    const added = writeCollectionEntry(fixture('file-loader-array.yaml'), 'yaml', 'three', {
      id: 'three',
      name: 'Third',
      geo: { lat: 5, lng: 6 },
    });
    expect(textOf(added.bytes)).toBe(
      '- id: one\n  name: First\n  geo: { lat: 1, lng: 2 }\n- id: two\n  name: "Second"\n  geo:\n    lat: 3\n    lng: 4\n- id: three\n  name: Third\n  geo:\n    lat: 5\n    lng: 6\n',
    );
    const removed = writeCollectionEntry(fixture('file-loader-array.yaml'), 'yaml', 'one', null);
    expect(textOf(removed.bytes)).toBe(
      '- id: two\n  name: "Second"\n  geo:\n    lat: 3\n    lng: 4\n',
    );
  });

  it('updates an object-shaped file by key', () => {
    const result = writeCollectionEntry(fixture('file-loader-map.yaml'), 'yaml', 'two', {
      name: 'Zwei',
    });
    expect(textOf(result.bytes)).toBe('one:\n  name: First\ntwo:\n  name: Zwei\n');
  });
});

describe('writeDataFile', () => {
  it('keeps CRLF in YAML data files', () => {
    const result = writeDataFile(fixture('crlf.yaml'), 'yaml', {
      title: 'CRLF data',
      items: ['a', 'b', 'c'],
    });
    expect(textOf(result.bytes)).toBe('title: CRLF data\r\nitems:\r\n  - a\r\n  - b\r\n  - c\r\n');
  });
});
