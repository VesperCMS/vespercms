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
import { commitMessage } from '../storage/github.ts';
import type { ChangeSet } from '../storage/types.ts';

const enc = new TextEncoder();
const dec = new TextDecoder();
const bytes = (text: string) => enc.encode(text);
const ada = { id: 'u_ada', name: 'Ada' };
const cal = { id: 'u_cal', name: 'Cal' };
const eve = { id: 'u_eve', name: 'Eve' };
const credit = { by: ada, noReplyDomain: 'users.noreply.vesper.test' };
const message = (summary: string) => ({ summary, trailers: { 'Vesper-Collection': 'blog' } });

/** The state's only draft, failing the test when there isn't exactly one. */
function only(state: DraftState): StoredDraft {
  const [draft, ...rest] = state.drafts;
  if (!draft || rest.length > 0)
    throw new Error(`Expected one draft, found ${String(state.drafts.length)}`);
  return draft;
}

/** A change set, failing the test when there's none to publish. */
function toPublish(
  state: DraftState,
  ids: readonly string[],
  by: { id: string; name: string } = ada,
): ChangeSet {
  const changeSet = publishChangeSet(state, ids, { ...credit, by });
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
  const save = (
    changes: Parameters<typeof saveDraft>[2]['changes'],
    summary = 'Save',
    by: { id: string; name: string } = ada,
    trailers: ChangeSet['message']['trailers'] = message(summary).trailers,
  ) =>
    saveDraft(state, site, { changes, message: { summary, trailers } }, by, {
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
      authors: [ada],
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
    const changeSet = publishChangeSet(state, ids, credit);
    expect(changeSet?.message).toEqual({
      summary: 'Edit A, and 1 more change',
      trailers: {
        'Vesper-Collection': 'blog',
        'Vesper-Editor': ['u_ada'],
        'Co-authored-by': ['Ada <u_ada@users.noreply.vesper.test>'],
      },
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

  it('list everyone who saved a draft, once each, in the order they first did', async () => {
    const { state, save } = await setup();
    const a = (text: string) => [
      { op: 'put' as const, path: 'src/content/blog/a.md', bytes: bytes(text) },
    ];
    await save(a('A2\n'), 'Edit A', ada);
    await save(a('A3\n'), 'Edit A', cal);
    await save(a('A4\n'), 'Edit A', ada);
    expect(only(state).authors).toEqual([ada, cal]);
    expect(only(state).updatedBy).toEqual(ada);

    // A save that joins two drafts keeps both drafts' authors.
    await save([{ op: 'put', path: 'src/content/blog/b.md', bytes: bytes('B2\n') }], 'Edit B', eve);
    await save(
      [
        { op: 'put', path: 'src/content/blog/a.md', bytes: bytes('A5\n') },
        { op: 'put', path: 'src/content/blog/b.md', bytes: bytes('B3\n') },
      ],
      'Move',
      cal,
    );
    expect(only(state).authors).toEqual([ada, cal, eve]);

    // Someone renamed keeps their place, under their new name.
    const renamed = { id: 'u_ada', name: 'Ada Lovelace' };
    await save(a('A6\n'), 'Edit A', renamed);
    expect(only(state).authors).toEqual([renamed, cal, eve]);
  });

  it('keep every collection of the drafts a save joins', async () => {
    const { state, save } = await setup();
    await save([{ op: 'put', path: 'src/content/blog/a.md', bytes: bytes('A2\n') }], 'Edit A');
    await save(
      [{ op: 'put', path: 'src/content/pages/about.md', bytes: bytes('About2\n') }],
      'Edit About',
      ada,
      { 'Vesper-Collection': 'pages' },
    );
    await save(
      [
        { op: 'put', path: 'src/content/blog/a.md', bytes: bytes('A3\n') },
        { op: 'put', path: 'src/content/pages/about.md', bytes: bytes('About3\n') },
      ],
      'Move',
      ada,
      { 'Vesper-Collection': 'pages' },
    );
    expect(only(state).trailers).toEqual({ 'Vesper-Collection': ['blog', 'pages'] });
  });

  it('credit the publisher, then each draft’s authors, each once, at no-reply addresses', async () => {
    const { state, save } = await setup();
    const put = (path: string, text: string) => [{ op: 'put' as const, path, bytes: bytes(text) }];
    await save(put('src/content/blog/a.md', 'A2\n'), 'Edit A', cal);
    await save(put('src/content/blog/a.md', 'A3\n'), 'Edit A', eve);
    await save(put('src/content/blog/b.md', 'B2\n'), 'Edit B', ada);
    await save(put('src/content/blog/b.md', 'B3\n'), 'Edit B', cal);
    // A draft's own trailers never credit anyone: only the cloud does.
    await save(put('src/content/pages/about.md', 'About2\n'), 'Edit About', cal, {
      'Vesper-Collection': 'pages',
      'Vesper-Editor': 'u_forged',
      'Co-Authored-By': 'Mallory <mallory@example.com>',
    });
    const ids = state.drafts.map((d) => d.id);
    expect(commitMessage(toPublish(state, ids, eve))).toBe(
      [
        'Edit A, and 2 more changes',
        '',
        'Vesper-Collection: blog',
        'Vesper-Collection: pages',
        'Vesper-Editor: u_eve',
        'Vesper-Editor: u_cal',
        'Vesper-Editor: u_ada',
        'Co-authored-by: Eve <u_eve@users.noreply.vesper.test>',
        'Co-authored-by: Cal <u_cal@users.noreply.vesper.test>',
        'Co-authored-by: Ada <u_ada@users.noreply.vesper.test>',
        '',
      ].join('\n'),
    );

    // A publisher who also wrote the draft is named once, first.
    expect(commitMessage(toPublish(state, [ids[0] ?? ''], cal))).toBe(
      'Edit A\n\nVesper-Collection: blog\nVesper-Editor: u_cal\nVesper-Editor: u_eve\nCo-authored-by: Cal <u_cal@users.noreply.vesper.test>\nCo-authored-by: Eve <u_eve@users.noreply.vesper.test>\n',
    );
    expect(commitMessage(toPublish(state, [ids[1] ?? ''], ada))).toBe(
      'Edit B\n\nVesper-Collection: blog\nVesper-Editor: u_ada\nVesper-Editor: u_cal\nCo-authored-by: Ada <u_ada@users.noreply.vesper.test>\nCo-authored-by: Cal <u_cal@users.noreply.vesper.test>\n',
    );
  });

  it('keep a name to one line that can’t end its address early', async () => {
    const { state, save } = await setup();
    await save([{ op: 'put', path: 'src/content/blog/a.md', bytes: bytes('A2\n') }], 'Edit A', {
      id: 'u_odd',
      name: ' Odd\n<Name> ',
    });
    const message = commitMessage(toPublish(state, [only(state).id], { id: 'u_blank', name: ' ' }));
    expect(message.split('\n').filter((line) => line.startsWith('Co-authored-by: '))).toEqual([
      'Co-authored-by: Vesper editor <u_blank@users.noreply.vesper.test>',
      'Co-authored-by: Odd Name <u_odd@users.noreply.vesper.test>',
    ]);
  });
});
