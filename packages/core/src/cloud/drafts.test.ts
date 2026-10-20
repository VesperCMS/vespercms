import { describe, expect, it } from 'vitest';
import { MemoryStorage } from '../storage/memory.ts';
import { gitBlobSha } from '../storage/git-blob-sha.ts';
import {
  clearDrafts,
  discardDraft,
  emptyDraftState,
  overlayEntries,
  publishChangeSet,
  readOverlay,
  rebaseDraft,
  saveDraft,
  type DraftState,
  type StoredDraft,
} from './drafts.ts';
import type { ChangeSet } from '../storage/types.ts';

const enc = new TextEncoder();
const dec = new TextDecoder();
const bytes = (text: string) => enc.encode(text);
const ada = { id: 'u_ada', name: 'Ada' };
const message = (summary: string) => ({ summary, trailers: { 'Vesper-Collection': 'blog' } });

/** The state's only draft, failing the test when there isn't exactly one. */
function only(state: DraftState): StoredDraft {
  const [draft, ...rest] = state.drafts;
  if (!draft || rest.length > 0)
    throw new Error(`Expected one draft, found ${String(state.drafts.length)}`);
  return draft;
}

/** A change set, failing the test when there's none to publish. */
function toPublish(state: DraftState, ids: readonly string[]): ChangeSet {
  const changeSet = publishChangeSet(state, ids);
  if (!changeSet) throw new Error('Nothing to publish');
  return changeSet;
}

async function setup() {
  const site = await MemoryStorage.create({
    'src/content/blog/a.md': 'A\n',
    'src/content/blog/b.md': 'B\n',
    'src/content/pages/about.md': 'About\n',
  });
  const state: DraftState = emptyDraftState();
  let n = 0;
  const save = (changes: Parameters<typeof saveDraft>[2]['changes'], summary = 'Save') =>
    saveDraft(state, site, { changes, message: message(summary) }, ada, {
      newId: () => `d_${String(++n)}`,
      now: new Date('2026-10-20T12:00:00Z'),
    });
  const read = async (path: string) => {
    const file = await readOverlay(state, site, path);
    return file && dec.decode(file.bytes);
  };
  const version = async (path: string) => (await readOverlay(state, site, path))?.version ?? null;
  return { site, state, save, read, version };
}

describe('cloud drafts', () => {
  it('show the site with its drafts, and leave what’s published alone', async () => {
    const { site, state, save, read } = await setup();
    const a = (await site.read('src/content/blog/a.md'))?.version;
    const result = await save([
      { op: 'put', path: 'src/content/blog/a.md', bytes: bytes('A2\n'), expectedVersion: a },
    ]);
    expect(result.ok).toBe(true);
    expect(await read('src/content/blog/a.md')).toBe('A2\n');
    expect(dec.decode((await site.read('src/content/blog/a.md'))?.bytes)).toBe('A\n');
    expect(state.drafts).toHaveLength(1);
    expect(state.drafts[0]).toMatchObject({
      id: 'd_1',
      summary: 'Save',
      files: [
        {
          op: 'put',
          path: 'src/content/blog/a.md',
          version: await gitBlobSha(bytes('A2\n')),
          base: a,
        },
      ],
      updatedBy: ada,
    });
    const entries = overlayEntries(await site.list(), state.drafts);
    expect(entries.find((e) => e.path === 'src/content/blog/a.md')?.version).toBe(
      await gitBlobSha(bytes('A2\n')),
    );
  });

  it('check expected versions against the drafts, so a second editor gets a conflict', async () => {
    const { site, save, version } = await setup();
    const a = (await site.read('src/content/blog/a.md'))?.version;
    await save([
      { op: 'put', path: 'src/content/blog/a.md', bytes: bytes('A2\n'), expectedVersion: a },
    ]);
    const stale = await save([
      { op: 'put', path: 'src/content/blog/a.md', bytes: bytes('A3\n'), expectedVersion: a },
    ]);
    expect(stale).toEqual({
      ok: false,
      reason: 'conflict',
      conflicts: [
        {
          path: 'src/content/blog/a.md',
          expected: a,
          actual: await version('src/content/blog/a.md'),
        },
      ],
    });
    const fresh = await save([
      {
        op: 'put',
        path: 'src/content/blog/a.md',
        bytes: bytes('A3\n'),
        expectedVersion: await version('src/content/blog/a.md'),
      },
    ]);
    expect(fresh.ok).toBe(true);
  });

  it('keep one draft per file, and join drafts a save touches together', async () => {
    const { state, save, version } = await setup();
    await save([{ op: 'put', path: 'src/content/blog/a.md', bytes: bytes('A2\n') }], 'Edit A');
    await save([{ op: 'put', path: 'src/content/blog/b.md', bytes: bytes('B2\n') }], 'Edit B');
    expect(state.drafts.map((d) => d.id)).toEqual(['d_1', 'd_2']);
    await save(
      [
        {
          op: 'put',
          path: 'src/content/blog/a.md',
          bytes: bytes('A3\n'),
          expectedVersion: await version('src/content/blog/a.md'),
        },
        { op: 'put', path: 'src/content/blog/b.md', bytes: bytes('B3\n') },
      ],
      'Move',
    );
    expect(state.drafts).toHaveLength(1);
    expect(state.drafts[0]?.summary).toBe('Move');
    expect(state.drafts[0]?.files.map((f) => f.path).sort()).toEqual([
      'src/content/blog/a.md',
      'src/content/blog/b.md',
    ]);
  });

  it('drop a file drafted back to what’s published, and a draft with nothing left', async () => {
    const { state, save } = await setup();
    await save([{ op: 'put', path: 'src/content/blog/a.md', bytes: bytes('A2\n') }]);
    const back = await save([{ op: 'put', path: 'src/content/blog/a.md', bytes: bytes('A\n') }]);
    expect(back).toEqual({ ok: true, draft: null });
    expect(state.drafts).toEqual([]);
    await save([
      { op: 'put', path: 'src/content/blog/new.md', bytes: bytes('N\n'), expectedVersion: null },
    ]);
    await save([{ op: 'delete', path: 'src/content/blog/new.md' }]);
    expect(state.drafts).toEqual([]);
  });

  it('draft a move as a deletion and a new file, and refuse a move onto a file', async () => {
    const { save, read, state } = await setup();
    const moved = await save([
      { op: 'move', from: 'src/content/blog/a.md', to: 'src/content/blog/c.md' },
    ]);
    expect(moved.ok).toBe(true);
    expect(await read('src/content/blog/a.md')).toBeNull();
    expect(await read('src/content/blog/c.md')).toBe('A\n');
    expect(state.drafts[0]?.files.map((f) => [f.op, f.path])).toEqual([
      ['delete', 'src/content/blog/a.md'],
      ['put', 'src/content/blog/c.md'],
    ]);
    const onto = await save([
      { op: 'move', from: 'src/content/blog/b.md', to: 'src/content/blog/c.md' },
    ]);
    expect(onto.ok).toBe(false);
  });

  it('publish as one change set expecting each file’s base, so later publishes conflict', async () => {
    const { site, state, save } = await setup();
    await save([{ op: 'put', path: 'src/content/blog/a.md', bytes: bytes('A2\n') }], 'Edit A');
    await save([{ op: 'delete', path: 'src/content/blog/b.md' }], 'Delete B');
    const ids = state.drafts.map((d) => d.id);
    const changeSet = publishChangeSet(state, ids);
    expect(changeSet?.message).toEqual({
      summary: 'Edit A, and 1 more change',
      trailers: { 'Vesper-Collection': 'blog' },
    });
    expect(await site.commit(toPublish(state, ids))).toMatchObject({ ok: true });
    clearDrafts(state, ids);
    expect(state.drafts).toEqual([]);

    // Someone publishes A again while a new draft of it waits: publishing that draft is a conflict.
    await save(
      [{ op: 'put', path: 'src/content/blog/a.md', bytes: bytes('A3\n') }],
      'Edit A again',
    );
    const a = (await site.read('src/content/blog/a.md'))?.version;
    await site.commit({
      changes: [
        {
          op: 'put',
          path: 'src/content/blog/a.md',
          bytes: bytes('Elsewhere\n'),
          expectedVersion: a,
        },
      ],
      message: { summary: 'Elsewhere' },
    });
    expect(await site.commit(toPublish(state, [only(state).id]))).toMatchObject({
      ok: false,
      reason: 'conflict',
    });
  });

  it('rebase a draft onto what’s published when the editor keeps theirs', async () => {
    const { site, state, save } = await setup();
    await save([{ op: 'put', path: 'src/content/blog/a.md', bytes: bytes('Mine\n') }]);
    const a = (await site.read('src/content/blog/a.md'))?.version;
    await site.commit({
      changes: [
        { op: 'put', path: 'src/content/blog/a.md', bytes: bytes('Theirs\n'), expectedVersion: a },
      ],
      message: { summary: 'Elsewhere' },
    });
    const id = only(state).id;
    expect(await rebaseDraft(state, site, id, ['src/content/blog/a.md'])).toBe(true);
    expect(await site.commit(toPublish(state, [id]))).toMatchObject({ ok: true });
    expect(dec.decode((await site.read('src/content/blog/a.md'))?.bytes)).toBe('Mine\n');
  });

  it('discard a draft and keep only the bytes drafts still point at', async () => {
    const { state, save } = await setup();
    await save([{ op: 'put', path: 'src/content/blog/a.md', bytes: bytes('A2\n') }]);
    await save([{ op: 'put', path: 'src/content/blog/a.md', bytes: bytes('A3\n') }]);
    expect(Object.keys(only(state).bytes)).toEqual([await gitBlobSha(bytes('A3\n'))]);
    const version = state.version;
    expect(discardDraft(state, only(state).id)).toBe(true);
    expect(state.drafts).toEqual([]);
    expect(state.version).toBe(version + 1);
    expect(discardDraft(state, 'nope')).toBe(false);
  });
});
