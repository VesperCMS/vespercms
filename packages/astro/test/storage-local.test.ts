import {
  mkdirSync,
  mkdtempSync,
  promises,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { runStorageContract } from '@vespercms/core/testing';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { LocalStorage, renameWithRetry } from '../src/node/storage-local.ts';

const roots: string[] = [];

function siteWith(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'vesper-local-'));
  roots.push(root);
  for (const [path, contents] of Object.entries(files)) {
    const target = join(root, ...path.split('/'));
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, contents);
  }
  return root;
}

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

runStorageContract('local', (initial) => Promise.resolve(new LocalStorage(siteWith(initial))), {
  describe,
  it,
  equal: (actual, expected, message) => {
    expect(actual, message).toEqual(expected);
  },
});

describe('LocalStorage', () => {
  it('never lists or writes build output, dependencies or git internals', async () => {
    const root = siteWith({
      'src/a.md': 'a',
      'node_modules/x/index.js': 'x',
      'dist/index.html': 'x',
      '.git/HEAD': 'x',
      '.astro/data-store.json': 'x',
    });
    const store = new LocalStorage(root);
    expect((await store.list()).map((e) => e.path)).toEqual(['src/a.md']);
    const result = await store.commit({
      message: { summary: 'x' },
      changes: [{ op: 'put', path: 'dist/evil.html', bytes: new TextEncoder().encode('x') }],
    });
    expect(result.ok ? null : result.reason).toBe('rejected');
  });

  it('retries a rename while Windows reports the file busy, and gives up on other errors', async () => {
    const busy = (code: string) => Object.assign(new Error(code), { code });
    let calls = 0;
    await renameWithRetry('a', 'b', () => {
      calls++;
      return calls < 3 ? Promise.reject(busy('EPERM')) : Promise.resolve();
    });
    expect(calls).toBe(3);

    calls = 0;
    await expect(
      renameWithRetry('a', 'b', () => {
        calls++;
        return Promise.reject(busy('ENOENT'));
      }),
    ).rejects.toThrow('ENOENT');
    expect(calls).toBe(1);
  });

  it('leaves no temporary file behind when a save fails', async () => {
    const root = siteWith({ 'src/content/a.md': 'a' });
    const store = new LocalStorage(root);
    const rename = vi
      .spyOn(promises, 'rename')
      .mockRejectedValue(Object.assign(new Error('EXDEV'), { code: 'EXDEV' }));
    try {
      const result = await store.commit({
        message: { summary: 'x' },
        changes: [{ op: 'put', path: 'src/content/a.md', bytes: new TextEncoder().encode('b') }],
      });
      expect(result.ok).toBe(false);
    } finally {
      rename.mockRestore();
    }
    expect(readdirSync(join(root, 'src', 'content'))).toEqual(['a.md']);
    expect(readFileSync(join(root, 'src', 'content', 'a.md'), 'utf8')).toBe('a');
  });

  it('writes bytes exactly, CRLF and all', async () => {
    const root = siteWith({});
    const store = new LocalStorage(root);
    const bytes = new TextEncoder().encode('---\r\ntitle: A\r\n---\r\n');
    await store.commit({
      message: { summary: 'x' },
      changes: [{ op: 'put', path: 'src/content/a.md', bytes }],
    });
    expect(new Uint8Array(readFileSync(join(root, 'src', 'content', 'a.md')))).toEqual(bytes);
  });
});
