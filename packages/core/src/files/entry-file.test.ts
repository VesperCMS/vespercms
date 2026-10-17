import { describe, expect, it } from 'vitest';
import { readEntryFile, writeEntryFile } from './entry-file.ts';
import { decodeUtf8, encodeUtf8 } from './text.ts';

const BOM = String.fromCharCode(0xfeff);
const bytes = (text: string) => encodeUtf8(text);
const textOf = (data: Uint8Array) => decodeUtf8(data) ?? '';

describe('readEntryFile', () => {
  it('reads frontmatter values and body', () => {
    const entry = readEntryFile(bytes('---\ntitle: Hi\n---\n\nBody\n'));
    expect(entry).toMatchObject({ status: 'editable', data: { title: 'Hi' }, body: '\n\nBody\n' });
  });

  it('treats a file without frontmatter as empty data plus body', () => {
    expect(readEntryFile(bytes('# Only body\n'))).toMatchObject({
      status: 'editable',
      data: {},
      body: '# Only body\n',
    });
  });

  it('is read-only for non-UTF-8 bytes and TOML frontmatter', () => {
    expect(
      readEntryFile(new Uint8Array([0x2d, 0x2d, 0x2d, 0x0a, 0xe9, 0x0a, 0x2d, 0x2d, 0x2d])),
    ).toMatchObject({
      status: 'read-only',
      reason: 'not-utf8',
    });
    expect(readEntryFile(bytes('+++\na = 1\n+++\n'))).toMatchObject({
      status: 'read-only',
      reason: 'toml',
    });
  });

  it('is source-only when the YAML can’t be edited structurally', () => {
    expect(readEntryFile(bytes('---\na: [x\n---\n'))).toMatchObject({
      status: 'source-only',
      reason: 'yaml-error',
    });
  });
});

describe('writeEntryFile', () => {
  const original = `${BOM}---\r\ntitle: Old\r\ntags: [a]\r\n---\r\n\r\nBody text.\r\n`;

  it('returns the same bytes when nothing changed', () => {
    const input = bytes(original);
    const result = writeEntryFile(input, {
      data: { title: 'Old', tags: ['a'] },
      body: '\r\n\r\nBody text.\r\n',
    });
    expect(result.changed).toBe(false);
    expect(result.bytes).toBe(input);
  });

  it('changes frontmatter without touching the BOM, line endings or body', () => {
    const result = writeEntryFile(bytes(original), { data: { title: 'New', tags: ['a'] } });
    expect(textOf(result.bytes)).toBe(
      `${BOM}---\r\ntitle: New\r\ntags: [a]\r\n---\r\n\r\nBody text.\r\n`,
    );
  });

  it('changes the body without touching the frontmatter', () => {
    const result = writeEntryFile(bytes(original), { body: '\r\n\r\nNew body.\r\n' });
    expect(textOf(result.bytes)).toBe(
      `${BOM}---\r\ntitle: Old\r\ntags: [a]\r\n---\r\n\r\nNew body.\r\n`,
    );
  });

  it('adds frontmatter to a file that had none', () => {
    const result = writeEntryFile(bytes('# Title\n'), { data: { title: 'T' } });
    expect(textOf(result.bytes)).toBe('---\ntitle: T\n---\n# Title\n');
  });

  it('refuses to write data into source-only frontmatter, but still allows body edits', () => {
    const input = bytes('---\na: [x\n---\nBody\n');
    expect(() => writeEntryFile(input, { data: { a: 1 } })).toThrow(/YAML|Flow|close/i);
    expect(textOf(writeEntryFile(input, { body: '\nNew\n' }).bytes)).toBe('---\na: [x\n---\nNew\n');
  });
});
