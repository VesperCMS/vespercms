import { gitBlobSha } from './git-blob-sha.ts';
import type { StorageAdapter } from './types.ts';

/**
 * The behavior every storage adapter must share, as a reusable test suite.
 * Local, GitHub and cloud adapters all run it, so "a save is atomic" and
 * "a stale version is a conflict" mean the same thing in every mode.
 *
 * The test framework is passed in, so core imports none.
 */
export type ContractHarness = {
  describe: (name: string, body: () => void) => void;
  it: (name: string, body: () => Promise<void>) => void;
  equal: (actual: unknown, expected: unknown, message?: string) => void;
};

export type AdapterFactory = (initial: Record<string, string>) => Promise<StorageAdapter>;

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const bytes = (text: string) => encoder.encode(text);
const message = { summary: 'Test save' };

export function runStorageContract(name: string, create: AdapterFactory, t: ContractHarness): void {
  const { describe, it, equal } = t;
  const initial = {
    'src/content/blog/a.md': '---\ntitle: A\n---\n',
    'src/content/blog/b.md': '---\ntitle: B\n---\n',
    'src/data/authors.json': '[]\n',
  };

  describe(`storage contract: ${name}`, () => {
    it('reads files with their git blob SHA as version', async () => {
      const store = await create(initial);
      const file = await store.read('src/content/blog/a.md');
      equal(file && decoder.decode(file.bytes), initial['src/content/blog/a.md']);
      equal(file?.version, await gitBlobSha(bytes(initial['src/content/blog/a.md'])));
      equal(await store.read('src/content/blog/missing.md'), null);
    });

    it('lists files sorted, optionally under a prefix', async () => {
      const store = await create(initial);
      equal(
        (await store.list()).map((entry) => entry.path),
        ['src/content/blog/a.md', 'src/content/blog/b.md', 'src/data/authors.json'],
      );
      equal(
        (await store.list({ prefix: 'src/content/' })).map((entry) => entry.path),
        ['src/content/blog/a.md', 'src/content/blog/b.md'],
      );
    });

    it('commits several files at once and moves head', async () => {
      const store = await create(initial);
      const before = await store.head();
      const result = await store.commit({
        message,
        changes: [
          { op: 'put', path: 'src/content/blog/a.md', bytes: bytes('changed\n') },
          {
            op: 'put',
            path: 'src/content/blog/c.md',
            bytes: bytes('new\n'),
            expectedVersion: null,
          },
          { op: 'delete', path: 'src/content/blog/b.md' },
        ],
      });
      equal(result.ok, true);
      equal((await store.head()).version === before.version, false);
      equal(
        (await store.list({ prefix: 'src/content/' })).map((e) => e.path),
        ['src/content/blog/a.md', 'src/content/blog/c.md'],
      );
      const changed = await store.read('src/content/blog/a.md');
      equal(changed?.version, await gitBlobSha(bytes('changed\n')));
    });

    it('reports a stale expected version as a conflict and writes nothing', async () => {
      const store = await create(initial);
      const before = await store.head();
      const result = await store.commit({
        message,
        changes: [
          { op: 'put', path: 'src/content/blog/b.md', bytes: bytes('fine\n') },
          {
            op: 'put',
            path: 'src/content/blog/a.md',
            bytes: bytes('x\n'),
            expectedVersion: 'not-the-version',
          },
        ],
      });
      equal(result.ok, false);
      equal(result.ok ? null : result.reason, 'conflict');
      equal((await store.head()).version, before.version);
      const untouched = await store.read('src/content/blog/b.md');
      equal(untouched && decoder.decode(untouched.bytes), initial['src/content/blog/b.md']);
    });

    it('refuses to create a file that already exists when told it must not', async () => {
      const store = await create(initial);
      const result = await store.commit({
        message,
        changes: [
          { op: 'put', path: 'src/content/blog/a.md', bytes: bytes('x'), expectedVersion: null },
        ],
      });
      equal(result.ok ? null : result.reason, 'conflict');
    });

    it('treats deleting a missing file as a conflict', async () => {
      const store = await create(initial);
      const result = await store.commit({
        message,
        changes: [{ op: 'delete', path: 'src/content/blog/zzz.md' }],
      });
      equal(result.ok ? null : result.reason, 'conflict');
    });

    it('moves a file, optionally with new contents, and refuses to overwrite', async () => {
      const store = await create(initial);
      const version = (await store.read('src/content/blog/a.md'))?.version;
      const moved = await store.commit({
        message,
        changes: [
          {
            op: 'move',
            from: 'src/content/blog/a.md',
            to: 'src/content/blog/2026/a.md',
            expectedVersion: version,
          },
        ],
      });
      equal(moved.ok, true);
      equal(await store.read('src/content/blog/a.md'), null);
      equal((await store.read('src/content/blog/2026/a.md'))?.version, version);

      const rewritten = await store.commit({
        message,
        changes: [
          {
            op: 'move',
            from: 'src/content/blog/2026/a.md',
            to: 'src/content/blog/a.md',
            bytes: bytes('moved\n'),
          },
        ],
      });
      equal(rewritten.ok, true);
      const back = await store.read('src/content/blog/a.md');
      equal(back && decoder.decode(back.bytes), 'moved\n');

      const blocked = await store.commit({
        message,
        changes: [{ op: 'move', from: 'src/content/blog/a.md', to: 'src/content/blog/b.md' }],
      });
      equal(blocked.ok ? null : blocked.reason, 'conflict');
    });

    it('rejects invalid paths and paths repeated in one save', async () => {
      const store = await create(initial);
      for (const path of ['../outside.md', '/abs.md', 'src\\win.md', 'src//double.md', 'C:/x.md']) {
        const result = await store.commit({
          message,
          changes: [{ op: 'put', path, bytes: bytes('x') }],
        });
        equal(result.ok ? null : result.reason, 'rejected', path);
      }
      const repeated = await store.commit({
        message,
        changes: [
          { op: 'put', path: 'src/x.md', bytes: bytes('1') },
          { op: 'delete', path: 'src/x.md' },
        ],
      });
      equal(repeated.ok ? null : repeated.reason, 'rejected');
    });
  });
}
