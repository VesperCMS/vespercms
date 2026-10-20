import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Manifest } from '../manifest/types.ts';
import type { FileChange } from '../storage/types.ts';
import {
  changeAccess,
  editsInCollection,
  fileAccess,
  grantKey,
  grantMatches,
  wholeSite,
  type Member,
} from './grants.ts';

// The playground's manifest: pages is a tree under src/content/pages,
// authors is one JSON file, settings a single YAML entry.
const manifest = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL('../../../astro/test/__snapshots__/playground.manifest.json', import.meta.url),
    ),
    'utf8',
  ),
) as Manifest;

const admissions: Member = {
  role: 'editor',
  grants: [{ collection: 'pages', match: 'admissions/**', publish: false }],
};
const blogger: Member = { role: 'editor', grants: [{ collection: 'blog' }] };
const put = (path: string, expectedVersion?: string | null): FileChange => ({
  op: 'put',
  path,
  bytes: new Uint8Array(),
  ...(expectedVersion !== undefined ? { expectedVersion } : {}),
});

describe('grant keys', () => {
  it('are the path in the collection without extension, index or order file', () => {
    expect(grantKey('admissions/apply.md')).toBe('admissions/apply');
    expect(grantKey('admissions/index.mdx')).toBe('admissions');
    expect(grantKey('admissions/_order.yaml')).toBe('admissions');
    expect(grantKey('_order.yaml')).toBe('');
    expect(grantKey('index.md')).toBe('');
    expect(grantKey('about.md')).toBe('about');
  });

  it('match a branch and its own section page', () => {
    expect(grantMatches('admissions/**', 'admissions')).toBe(true);
    expect(grantMatches('admissions/**', 'admissions/apply')).toBe(true);
    expect(grantMatches('admissions/**', 'admissions/visits/tours')).toBe(true);
    expect(grantMatches('admissions/**', 'admissions-old')).toBe(false);
    expect(grantMatches('admissions/**', 'about')).toBe(false);
    expect(grantMatches('admissions/*', 'admissions/visits/tours')).toBe(false);
    expect(grantMatches(undefined, 'anything/at/all')).toBe(true);
  });
});

describe('what a member may change', () => {
  it('gives admins everything, and viewers nothing', () => {
    for (const path of [
      'src/content/pages/about.md',
      'vesper.redirects.yaml',
      'src/data/authors.json',
    ]) {
      expect(fileAccess({ role: 'admin', grants: [] }, manifest, path)).toEqual({
        edit: true,
        publish: true,
      });
      expect(fileAccess({ role: 'viewer' }, manifest, path)).toEqual({
        edit: false,
        publish: false,
      });
    }
  });

  it('treats a member without grants as the whole site, and contributors never publish', () => {
    expect(wholeSite({ role: 'editor' })).toBe(true);
    expect(wholeSite({ role: 'editor', grants: [] })).toBe(false);
    expect(fileAccess({ role: 'contributor' }, manifest, 'vesper.redirects.yaml')).toEqual({
      edit: true,
      publish: false,
    });
  });

  it('keeps a folder grant to its branch, and to entries matched by path, never by slug', () => {
    const edit = (path: string) => fileAccess(admissions, manifest, path).edit;
    expect(edit('src/content/pages/admissions/index.md')).toBe(true);
    expect(edit('src/content/pages/admissions/apply.md')).toBe(true);
    expect(edit('src/content/pages/admissions/_order.yaml')).toBe(true);
    expect(edit('src/content/pages/about.md')).toBe(false);
    expect(edit('src/content/pages/_order.yaml')).toBe(false);
    expect(edit('src/content/blog/harbor-at-dawn.md')).toBe(false);
    expect(edit('vesper.redirects.yaml')).toBe(false);
    expect(edit('src/assets/blog/harbor-at-dawn.jpg')).toBe(false);
  });

  it('says when publishing needs approval', () => {
    expect(fileAccess(admissions, manifest, 'src/content/pages/admissions/apply.md')).toEqual({
      edit: true,
      publish: false,
    });
    expect(fileAccess(blogger, manifest, 'src/content/blog/harbor-at-dawn.md')).toEqual({
      edit: true,
      publish: true,
    });
  });

  it('reaches a one-file collection only through a grant for all of it', () => {
    const partial: Member = { role: 'editor', grants: [{ collection: 'authors', match: 'ada*' }] };
    const whole: Member = { role: 'editor', grants: [{ collection: 'authors' }] };
    expect(fileAccess(partial, manifest, 'src/data/authors.json').edit).toBe(false);
    expect(fileAccess(whole, manifest, 'src/data/authors.json').edit).toBe(true);
  });

  it('knows which collections to show a member', () => {
    expect(editsInCollection(admissions, 'pages')).toBe(true);
    expect(editsInCollection(admissions, 'blog')).toBe(false);
    expect(editsInCollection({ role: 'viewer' }, 'pages')).toBe(false);
    expect(editsInCollection({ role: 'editor' }, 'blog')).toBe(true);
  });
});

describe('a change set', () => {
  it('is refused whole when one file is outside the grants', () => {
    const result = changeAccess(admissions, manifest, [
      put('src/content/pages/admissions/apply.md', 'abc'),
      put('src/content/pages/about.md', 'def'),
    ]);
    expect(result).toEqual({
      ok: false,
      path: 'src/content/pages/about.md',
      message: 'This is outside what you can edit on this site. Ask a site admin.',
    });
  });

  it('needs a grant at both ends of a move, and the redirects file needs the whole site', () => {
    const move = (to: string): FileChange => ({
      op: 'move',
      from: 'src/content/pages/admissions/visit.md',
      to,
    });
    expect(
      changeAccess(admissions, manifest, [move('src/content/pages/admissions/tours.md')]),
    ).toEqual({
      ok: true,
      publish: false,
    });
    expect(changeAccess(admissions, manifest, [move('src/content/pages/visit.md')]).ok).toBe(false);
    const withRedirects = changeAccess(admissions, manifest, [
      move('src/content/pages/admissions/tours.md'),
      put('vesper.redirects.yaml', 'abc'),
    ]);
    expect(withRedirects).toMatchObject({ ok: false, path: 'vesper.redirects.yaml' });
    expect(withRedirects.ok || withRedirects.message).toMatch(/redirects/);
  });

  it('lets anyone who edits add new media, but not replace or remove what’s there', () => {
    const upload = put('src/assets/pages/campus.jpg', null);
    expect(changeAccess(admissions, manifest, [upload])).toEqual({ ok: true, publish: false });
    expect(changeAccess(blogger, manifest, [upload])).toEqual({ ok: true, publish: true });
    expect(changeAccess(admissions, manifest, [put('src/assets/pages/campus.jpg', 'abc')]).ok).toBe(
      false,
    );
    expect(changeAccess(admissions, manifest, [{ op: 'delete', path: 'public/logo.svg' }]).ok).toBe(
      false,
    );
    expect(changeAccess({ role: 'viewer' }, manifest, [upload]).ok).toBe(false);
  });

  it('publishes only when every file may be published', () => {
    const both: Member = {
      role: 'editor',
      grants: [
        { collection: 'blog' },
        { collection: 'pages', match: 'admissions/**', publish: false },
      ],
    };
    expect(changeAccess(both, manifest, [put('src/content/blog/a.md', 'x')])).toEqual({
      ok: true,
      publish: true,
    });
    expect(
      changeAccess(both, manifest, [
        put('src/content/blog/a.md', 'x'),
        put('src/content/pages/admissions/apply.md', 'y'),
      ]),
    ).toEqual({ ok: true, publish: false });
    expect(
      changeAccess({ role: 'contributor' }, manifest, [put('src/content/blog/a.md', 'x')]),
    ).toEqual({ ok: true, publish: false });
  });
});
