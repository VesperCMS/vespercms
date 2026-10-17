import { describe, expect, it } from 'vitest';
import { runStorageContract } from './contract.ts';
import { gitBlobSha } from './git-blob-sha.ts';
import { MemoryStorage } from './memory.ts';
import { InvalidPathError, normalizePath } from './paths.ts';

runStorageContract('memory', (initial) => MemoryStorage.create(initial), {
  describe,
  it,
  equal: (actual, expected, message) => {
    expect(actual, message).toEqual(expected);
  },
});

describe('gitBlobSha', () => {
  it('matches `git hash-object`', async () => {
    const encode = (text: string) => new TextEncoder().encode(text);
    expect(await gitBlobSha(encode(''))).toBe('e69de29bb2d1d6434b8b29ae775ad8c2e48c5391');
    expect(await gitBlobSha(encode('hello\n'))).toBe('ce013625030ba8dba906f756967f9e9ca394464a');
  });
});

describe('normalizePath', () => {
  it('accepts site-relative POSIX paths and drops a leading ./', () => {
    expect(normalizePath('./src/content/a.md')).toBe('src/content/a.md');
  });

  it.each(['', '../x', 'a/../b', '/abs', 'C:/x', 'a\\b', 'a//b', 'a/./b', 'nul\0'])(
    'refuses %j',
    (path) => {
      expect(() => normalizePath(path)).toThrow(InvalidPathError);
    },
  );
});

describe('MemoryStorage', () => {
  it('records successful commits only', async () => {
    const store = await MemoryStorage.create({ 'a.md': 'a' });
    await store.commit({ message: { summary: 'ok' }, changes: [{ op: 'delete', path: 'a.md' }] });
    await store.commit({
      message: { summary: 'fails' },
      changes: [{ op: 'delete', path: 'a.md' }],
    });
    expect(store.commits.map((c) => c.message.summary)).toEqual(['ok']);
  });
});
