import { describe, expect, it } from 'vitest';
import {
  BOM,
  decodeUtf8,
  encodeUtf8,
  lineEndingAt,
  lineEndings,
  lineOf,
  lineStarts,
  withLineEnding,
} from './text.ts';

describe('decodeUtf8', () => {
  it('keeps a byte-order mark instead of stripping it', () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, 0x61]);
    expect(decodeUtf8(bytes)).toBe(`${BOM}a`);
    expect(encodeUtf8(`${BOM}a`)).toEqual(bytes);
  });

  it('refuses invalid UTF-8 rather than replacing bytes', () => {
    expect(decodeUtf8(new Uint8Array([0x43, 0x61, 0x66, 0xe9]))).toBeNull();
  });
});

describe('line endings', () => {
  it('counts CRLF and LF separately and picks the dominant one', () => {
    expect(lineEndings('a\r\nb\r\nc\n')).toEqual({ dominant: '\r\n', crlf: 2, lf: 1, mixed: true });
    expect(lineEndings('a\nb')).toEqual({ dominant: '\n', crlf: 0, lf: 1, mixed: false });
    expect(lineEndings('no breaks').dominant).toBe('\n');
  });

  it('finds the ending of the line containing an offset', () => {
    const text = 'one\r\ntwo\nthree';
    expect(lineEndingAt(text, 1, '\n')).toBe('\r\n');
    expect(lineEndingAt(text, 6, '\r\n')).toBe('\n');
    expect(lineEndingAt(text, 11, '\r\n')).toBe('\r\n');
  });

  it('rewrites fragment line breaks to the target ending', () => {
    expect(withLineEnding('a\nb\n', '\r\n')).toBe('a\r\nb\r\n');
    expect(withLineEnding('a\r\nb\n', '\n')).toBe('a\nb\n');
  });
});

describe('lineStarts and lineOf', () => {
  it('maps offsets to 0-based lines', () => {
    const text = 'ab\ncd\r\n\nef';
    const starts = lineStarts(text);
    expect(starts).toEqual([0, 3, 7, 8]);
    expect([0, 2, 3, 6, 7, 8, 9].map((o) => lineOf(starts, o))).toEqual([0, 0, 1, 1, 2, 3, 3]);
  });
});
