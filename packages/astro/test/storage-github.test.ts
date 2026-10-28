import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GitHubError, GitHubStorage, gitBlobSha, type BlobCache } from '@vespercms/core';
import { runStorageContract } from '@vespercms/core/testing';
import { afterAll, describe, expect, it } from 'vitest';
import { createGitHubFake, type GitHubFake } from '../../../scripts/github-fake.mjs';

/*
 * GitHub mode's storage (spec §6.8) against a fake GitHub whose repository
 * is real git (scripts/github-fake.mjs), so SHAs, trees and fast-forward
 * refusals are git's own: the shared storage contract, then what only
 * GitHub has (a push from elsewhere mid-save, branch rules, expired
 * sign-ins, rate limits, truncated trees, batched reads).
 */

const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

function fakeWith(files: Record<string, string | Uint8Array>): GitHubFake {
  const dir = mkdtempSync(join(tmpdir(), 'vesper-github-'));
  dirs.push(dir);
  const fake = createGitHubFake({ dir: join(dir, 'repo.git') });
  fake.commitFiles(files, 'Seed');
  return fake;
}

function storageFor(
  fake: GitHubFake,
  extra: Partial<ConstructorParameters<typeof GitHubStorage>[0]> = {},
) {
  return new GitHubStorage({
    owner: fake.owner,
    repo: fake.repo,
    branch: fake.branch,
    token: fake.state.token,
    apiUrl: 'https://api.github.test',
    fetch: fake.fetch,
    snapshotTtlMs: 0,
    ...extra,
  });
}

runStorageContract('github', (initial) => Promise.resolve(storageFor(fakeWith(initial))), {
  describe,
  it,
  equal: (actual, expected, message) => {
    expect(actual, message).toEqual(expected);
  },
});

// ignoreBOM keeps a byte-order mark, which TextDecoder drops by default.
const text = (bytes: Uint8Array | undefined) =>
  new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes);
const encode = (value: string) => new TextEncoder().encode(value);

describe('GitHub storage', () => {
  it('saves several files as one commit by the editor, with the message and its trailers', async () => {
    const fake = fakeWith({ 'src/content/blog/a.md': '---\ntitle: A\n---\n' });
    const store = storageFor(fake);
    const result = await store.commit({
      changes: [
        { op: 'put', path: 'src/content/blog/a.md', bytes: encode('---\ntitle: B\n---\n') },
        {
          op: 'put',
          path: 'src/assets/blog/b.png',
          bytes: new Uint8Array([137, 80, 78, 71, 0, 255]),
        },
      ],
      message: { summary: 'Update “B” in Blog posts', trailers: { 'Vesper-Collection': 'blog' } },
    });
    expect(result.ok).toBe(true);
    const [latest] = fake.log();
    expect(latest).toMatchObject({
      author: 'editor',
      message: 'Update “B” in Blog posts\n\nVesper-Collection: blog',
    });
    expect(latest?.changed.sort()).toEqual([
      'A\tsrc/assets/blog/b.png',
      'M\tsrc/content/blog/a.md',
    ]);
    expect([...(fake.files()['src/assets/blog/b.png'] ?? [])]).toEqual([137, 80, 78, 71, 0, 255]);
  });

  it('keeps bytes exactly: CRLF, a byte-order mark, and files that aren’t UTF-8', async () => {
    const crlf = '﻿---\r\ntitle: A\r\n---\r\n';
    const latin1 = new Uint8Array([0x63, 0x61, 0x66, 0xe9, 0x0a]);
    const fake = fakeWith({ 'src/a.md': crlf, 'src/b.txt': latin1 });
    const store = storageFor(fake);
    await store.list({ prefix: 'src/' });
    const a = await store.read('src/a.md');
    const b = await store.read('src/b.txt');
    expect(a?.version).toBe(await gitBlobSha(encode(crlf)));
    expect(text(a?.bytes)).toBe(crlf);
    expect([...(b?.bytes ?? [])]).toEqual([...latin1]);
  });

  it('builds on a push from elsewhere that touched other files, in one retry', async () => {
    const fake = fakeWith({ 'a.md': 'a\n', 'b.md': 'b\n' });
    const store = storageFor(fake);
    const before = (await store.read('a.md'))?.version;
    fake.state.beforeRefUpdate = () => fake.commitFiles({ 'b.md': 'b, elsewhere\n' });
    const result = await store.commit({
      changes: [
        {
          op: 'put',
          path: 'a.md',
          bytes: encode('a, here\n'),
          ...(before ? { expectedVersion: before } : {}),
        },
      ],
      message: { summary: 'Update A' },
    });
    expect(result.ok).toBe(true);
    expect(text(fake.files()['a.md'])).toBe('a, here\n');
    expect(text(fake.files()['b.md'])).toBe('b, elsewhere\n');
  });

  it('reports a conflict when the push from elsewhere touched the same file', async () => {
    const fake = fakeWith({ 'a.md': 'a\n' });
    const store = storageFor(fake);
    const before = (await store.read('a.md'))?.version ?? '';
    fake.state.beforeRefUpdate = () => fake.commitFiles({ 'a.md': 'a, elsewhere\n' });
    const result = await store.commit({
      changes: [{ op: 'put', path: 'a.md', bytes: encode('a, here\n'), expectedVersion: before }],
      message: { summary: 'Update A' },
    });
    expect(result).toMatchObject({ ok: false, reason: 'conflict', conflicts: [{ path: 'a.md' }] });
    expect(text(fake.files()['a.md'])).toBe('a, elsewhere\n');
  });

  it('says plainly when the branch’s rules refuse a direct publish', async () => {
    const fake = fakeWith({ 'a.md': 'a\n' });
    fake.state.protected = true;
    const result = await storageFor(fake).commit({
      changes: [{ op: 'put', path: 'a.md', bytes: encode('b\n') }],
      message: { summary: 'Update A' },
    });
    expect(result).toEqual({
      ok: false,
      reason: 'rejected',
      message:
        "This site's GitHub settings don't allow publishing straight to main. Changes must be made through a pull request.",
    });
  });

  it('throws plain errors for an expired sign-in and a rate limit', async () => {
    const fake = fakeWith({ 'a.md': 'a\n' });
    await expect(storageFor(fake, { token: 'expired' }).list()).rejects.toMatchObject({
      kind: 'auth',
      message: 'Your GitHub sign-in has expired. Sign in again.',
    });
    fake.state.rateLimited = true;
    const error = await storageFor(fake)
      .list()
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GitHubError);
    expect(error).toMatchObject({ kind: 'rate-limit' });
    expect((error as GitHubError).retryAt?.getTime()).toBeGreaterThan(Date.now());
  });

  it('works inside a repository’s subfolder, as a site in a monorepo', async () => {
    const fake = fakeWith({ 'sites/college/src/a.md': 'a\n', 'README.md': 'repo\n' });
    const store = storageFor(fake, { root: 'sites/college' });
    expect((await store.list()).map((e) => e.path)).toEqual(['src/a.md']);
    await store.commit({
      changes: [{ op: 'move', from: 'src/a.md', to: 'src/b.md' }],
      message: { summary: 'Move A' },
    });
    expect(Object.keys(fake.files()).sort()).toEqual(['README.md', 'sites/college/src/b.md']);
  });

  it('holds an upload for the next save, so the entry and its image are one commit', async () => {
    const fake = fakeWith({ 'src/content/blog/a.md': '---\ntitle: A\n---\n' });
    const store = storageFor(fake);
    const before = fake.log().length;
    const held = await store.commit({
      changes: [
        {
          op: 'put',
          path: 'src/assets/blog/b.png',
          bytes: new Uint8Array([1, 2, 3]),
          expectedVersion: null,
        },
      ],
      message: { summary: 'Upload b.png' },
      defer: true,
    });
    expect(held.ok).toBe(true);
    expect(fake.log()).toHaveLength(before);
    // Held, it's listed and readable, so previews and duplicate checks see it.
    expect((await store.list({ prefix: 'src/assets/' })).map((e) => e.path)).toEqual([
      'src/assets/blog/b.png',
    ]);
    expect([...((await store.read('src/assets/blog/b.png'))?.bytes ?? [])]).toEqual([1, 2, 3]);

    const version = (await store.read('src/content/blog/a.md'))?.version ?? '';
    await store.commit({
      changes: [
        {
          op: 'put',
          path: 'src/content/blog/a.md',
          bytes: encode('---\ntitle: B\n---\n'),
          expectedVersion: version,
        },
      ],
      message: { summary: 'Update B' },
    });
    expect(fake.log()).toHaveLength(before + 1);
    expect(fake.log()[0]?.changed.sort()).toEqual([
      'A\tsrc/assets/blog/b.png',
      'M\tsrc/content/blog/a.md',
    ]);
  });

  it('forgets a held upload that’s deleted before the next save', async () => {
    const fake = fakeWith({ 'a.md': 'a\n' });
    const store = storageFor(fake);
    await store.commit({
      changes: [{ op: 'put', path: 'b.png', bytes: new Uint8Array([1]), expectedVersion: null }],
      message: { summary: 'Upload b.png' },
      defer: true,
    });
    const before = fake.log().length;
    expect(
      (
        await store.commit({
          changes: [{ op: 'delete', path: 'b.png' }],
          message: { summary: 'Delete b.png' },
        })
      ).ok,
    ).toBe(true);
    expect(fake.log()).toHaveLength(before);
    expect(await store.read('b.png')).toBeNull();
  });

  it('reads a tree GitHub truncates folder by folder', async () => {
    const fake = fakeWith({ 'src/a.md': 'a\n', 'src/deep/b.md': 'b\n' });
    fake.state.truncate = true;
    expect((await storageFor(fake).list()).map((e) => e.path)).toEqual([
      'src/a.md',
      'src/deep/b.md',
    ]);
  });

  it('reads a listed folder’s text in one batch, and nothing again from a warm cache', async () => {
    const files = Object.fromEntries(
      Array.from({ length: 30 }, (_, i) => [
        `src/content/blog/post-${String(i)}.md`,
        `# ${String(i)}\n`,
      ]),
    );
    const fake = fakeWith(files);
    const held = new Map<string, Uint8Array>();
    const cache: BlobCache = {
      get: (sha) => Promise.resolve(held.get(sha)),
      put: (sha, bytes) => {
        held.set(sha, bytes);
        return Promise.resolve();
      },
    };
    const store = storageFor(fake, { cache });
    for (const entry of await store.list({ prefix: 'src/content/blog/' }))
      await store.read(entry.path);
    const requests = fake.state.log.filter((line) => /graphql|blobs/.test(line));
    expect(requests).toEqual(['POST /graphql']);

    fake.state.log.length = 0;
    const again = storageFor(fake, { cache });
    for (const entry of await again.list({ prefix: 'src/content/blog/' }))
      await again.read(entry.path);
    expect(fake.state.log.filter((line) => /graphql|blobs/.test(line))).toEqual([]);
  });
});
