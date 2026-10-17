import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { runStorageContract } from '@vesper/core/testing';
import { afterAll, describe, expect, it } from 'vitest';
import { LocalStorage } from '../src/node/storage-local.ts';

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
