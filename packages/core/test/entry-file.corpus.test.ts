import { describe, expect, it } from 'vitest';
import { readEntryFile, writeEntryFile } from '../src/files/entry-file.ts';
import type { DataObject } from '../src/files/equal.ts';
import { decodeUtf8 } from '../src/files/text.ts';
import { allFiles } from './helpers/corpus.ts';

const entries = allFiles().filter((file) => /\.(md|mdx|mdoc)$/.test(file.name));

const STATUS: Record<string, string> = {
  'frontmatter/not-utf8.md': 'read-only',
  'frontmatter/toml.md': 'read-only',
  'frontmatter/duplicate-keys.md': 'source-only',
  'frontmatter/invalid-yaml.md': 'source-only',
  'frontmatter/parser-disagreement.md': 'source-only',
  'frontmatter/tags.md': 'source-only',
};

describe('entry files over the corpus', () => {
  for (const file of entries) {
    const label = `${file.source}/${file.name}`;
    const entry = readEntryFile(file.bytes);
    const expected = file.source === 'fixtures' ? (STATUS[file.name] ?? 'editable') : 'editable';

    it(`${label}: reads as ${expected}`, () => {
      expect(entry.status).toBe(expected);
    });
    if (entry.status !== 'editable') continue;
    const text = decodeUtf8(file.bytes) ?? '';
    const bodyOffset = entry.split.bodyOffset;

    it(`${label}: an unchanged save returns the same bytes`, () => {
      const result = writeEntryFile(file.bytes, {
        data: structuredClone(entry.data),
        body: entry.body,
      });
      expect(result.changed).toBe(false);
      expect(result.bytes).toBe(file.bytes);
    });

    it(`${label}: a body edit leaves every frontmatter byte alone`, () => {
      const result = writeEntryFile(file.bytes, { body: `${entry.body}\nEdited.\n` });
      const out = decodeUtf8(result.bytes) ?? '';
      expect(out.slice(0, bodyOffset)).toBe(text.slice(0, bodyOffset));
      expect(out.slice(bodyOffset)).toBe(`${entry.body}\nEdited.\n`);
    });

    const firstKey = Object.keys(entry.data).find((key) => typeof entry.data[key] === 'string');
    const firstValue = firstKey === undefined ? undefined : entry.data[firstKey];
    if (firstKey !== undefined && typeof firstValue === 'string') {
      it(`${label}: a frontmatter edit leaves every body byte alone`, () => {
        const data: DataObject = {
          ...structuredClone(entry.data),
          [firstKey]: `${firstValue} (edited)`,
        };
        const result = writeEntryFile(file.bytes, { data });
        const out = decodeUtf8(result.bytes) ?? '';
        expect(out.endsWith(text.slice(bodyOffset))).toBe(true);
        expect(readEntryFile(result.bytes)).toMatchObject({ status: 'editable', data });
      });
    }
  }
});
