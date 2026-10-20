import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CloudClient, authorizeUrl, createDpopKey, createPkce, type Manifest } from '@vesper/core';
import { runStorageContract } from '@vesper/core/testing';
import { afterAll, describe, expect, it } from 'vitest';
import { createCloudFake } from '../../../../scripts/cloud-fake.mjs';
import { createGitHubFake } from '../../../../scripts/github-fake.mjs';
import { CloudStorage } from './storage.ts';

// The cloud's storage keeps the same contract as every other adapter: a
// draft save is atomic, and a stale version is a conflict.

const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

const manifest = {
  version: 1,
  site: { srcDir: 'src', contentConfig: 'src/content.config.ts' },
  collections: [],
} as unknown as Manifest;
const ORIGIN = 'https://site.example';

async function signedIn(initial: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), 'vesper-cloud-storage-'));
  dirs.push(dir);
  const github = createGitHubFake({ dir: join(dir, 'repo.git'), login: 'vesper[bot]' });
  if (Object.keys(initial).length > 0) github.commitFiles(initial, 'Seed');
  const cloud = createCloudFake({
    github,
    manifest,
    site: { id: 'site_test', name: 'Test', origins: [ORIGIN] },
    people: [{ id: 'u_admin', name: 'Ada', email: 'ada@example.edu', role: 'admin' }],
  });
  const { verifier, challenge } = await createPkce();
  const redirectUri = `${ORIGIN}/admin/`;
  const back = await cloud.fetch(
    authorizeUrl(cloud.settings, { redirectUri, state: 'st_test', challenge }),
  );
  const location = back.headers.get('location') ?? '';
  const code = new URLSearchParams(location.slice(location.indexOf('?') + 1)).get('code') ?? '';
  const client = new CloudClient({
    settings: cloud.settings,
    key: await createDpopKey(),
    fetch: cloud.fetch,
  });
  await client.exchangeCode({ code, verifier, redirectUri });
  return { github, cloud, client };
}

runStorageContract(
  'cloud drafts',
  async (initial) => {
    const { client } = await signedIn(initial);
    return new CloudStorage({ client, snapshotTtlMs: 0 });
  },
  {
    describe,
    it,
    equal: (actual, expected, message) => {
      expect(actual, message).toEqual(expected);
    },
  },
);

describe('cloud storage', () => {
  it('keeps saves as drafts the published site doesn’t see', async () => {
    const { github, client } = await signedIn({ 'src/content/blog/a.md': 'A\n' });
    const storage = new CloudStorage({ client, snapshotTtlMs: 0 });
    const file = await storage.read('src/content/blog/a.md');
    const result = await storage.commit({
      changes: [
        {
          op: 'put',
          path: 'src/content/blog/a.md',
          bytes: new TextEncoder().encode('A2\n'),
          expectedVersion: file?.version ?? null,
        },
      ],
      message: { summary: 'Update A' },
    });
    expect(result.ok).toBe(true);
    const read = await storage.read('src/content/blog/a.md');
    expect(new TextDecoder().decode(read?.bytes)).toBe('A2\n');
    expect(new TextDecoder().decode(github.files()['src/content/blog/a.md'])).toBe('A\n');
    expect((await storage.drafts()).drafts.map((d) => d.summary)).toEqual(['Update A']);
  });

  it('sends a held upload with the next save, as one draft', async () => {
    const { client } = await signedIn({ 'src/content/blog/a.md': 'A\n' });
    const storage = new CloudStorage({ client, snapshotTtlMs: 0 });
    await storage.commit({
      changes: [
        {
          op: 'put',
          path: 'src/assets/blog/a.jpg',
          bytes: new Uint8Array([1, 2]),
          expectedVersion: null,
        },
      ],
      message: { summary: 'Add a.jpg' },
      defer: true,
    });
    expect((await storage.drafts()).drafts).toEqual([]);
    expect((await storage.read('src/assets/blog/a.jpg'))?.bytes).toEqual(new Uint8Array([1, 2]));
    await storage.commit({
      changes: [
        { op: 'put', path: 'src/content/blog/a.md', bytes: new TextEncoder().encode('A2\n') },
      ],
      message: { summary: 'Update A' },
    });
    const { drafts } = await storage.drafts();
    expect(drafts).toHaveLength(1);
    expect(drafts[0]?.files.map((f) => f.path).sort()).toEqual([
      'src/assets/blog/a.jpg',
      'src/content/blog/a.md',
    ]);
  });

  it('fails a read when the cloud can’t be reached, rather than calling the file missing', async () => {
    const { cloud, client } = await signedIn({ 'src/content/blog/a.md': 'A\n' });
    const storage = new CloudStorage({ client, snapshotTtlMs: 60_000 });
    await storage.list();
    const original = cloud.handle;
    cloud.state.down = true;
    const down = new CloudStorage({
      client: new CloudClient({
        settings: cloud.settings,
        key: await createDpopKey(),
        fetch: () => Promise.reject(new TypeError('Failed to fetch')),
        tokens: { access: 'a', refresh: 'r', expiresAt: Date.now() + 600_000 },
      }),
    });
    await expect(down.read('src/content/blog/a.md')).rejects.toThrow('Failed to fetch');
    expect(original).toBe(cloud.handle);
  });
});
