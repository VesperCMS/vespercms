import { mkdtempSync, readFileSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { extractMarkdocSchema, markdocFields, type Manifest } from '@vesper/core';
import { z } from 'astro/zod';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDevApi, refusal } from './dev-api.ts';

const manifest: Manifest = {
  manifestVersion: 1,
  generator: { name: 'test', version: '0' },
  hash: 'x',
  site: { srcDir: 'src' },
  collections: [
    {
      name: 'blog',
      label: 'Blog posts',
      editable: true,
      source: {
        loader: 'glob',
        base: 'src/content/blog',
        pattern: '**/*.md',
        generateId: 'default',
        formats: ['md'],
      },
      entryKind: 'content',
      fields: [{ path: ['title'], kind: 'string', required: true, label: 'Title' }],
      presentation: {},
    },
  ],
  forms: [],
  diagnostics: [],
};

// A Markdoc collection, with a tag whose title is required and a check only the real config has.
const markdocConfig = {
  tags: {
    youtube: {
      selfClosing: true,
      attributes: {
        id: {
          type: String,
          required: true,
          validate: (value: unknown) =>
            value === 'banned'
              ? [{ id: 'id', level: 'error', message: 'That video is gone.' }]
              : [],
        },
        title: { type: String, required: true },
      },
    },
  },
};
manifest.collections.push({
  name: 'docs',
  label: 'Docs',
  editable: true,
  source: {
    loader: 'glob',
    base: 'src/content/docs',
    pattern: '**/[^_]*.mdoc',
    generateId: 'default',
    formats: ['mdoc'],
  },
  entryKind: 'content',
  fields: [{ path: ['title'], kind: 'string', required: true, label: 'Title' }],
  presentation: {},
});
manifest.markdoc = extractMarkdocSchema(markdocConfig, {
  hints: { youtube: { label: 'YouTube video' } },
  fields: (tag, hint) => markdocFields(tag, hint),
});

const schemas = new Map<string, unknown>([
  ['blog', z.object({ title: z.string().min(1) })],
  ['docs', z.object({ title: z.string() })],
]);

let root: string;
let server: Server;
let base: string;

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'vesper-dev-api-'));
  mkdirSync(join(root, 'src/content/blog'), { recursive: true });
  mkdirSync(join(root, 'src/assets'), { recursive: true });
  writeFileSync(join(root, 'src/content/blog/hello.md'), '---\ntitle: Hello\n---\nBody\n');
  writeFileSync(join(root, 'src/assets/dot.png'), new Uint8Array([137, 80, 78, 71]));
  writeFileSync(join(root, '.env'), 'SECRET=1\n');
  mkdirSync(join(root, 'src/content/docs'), { recursive: true });
  writeFileSync(join(root, 'src/content/docs/intro.mdoc'), '---\ntitle: Intro\n---\nHi.\n');
  writeFileSync(join(root, 'src/content/docs/_hours.mdoc'), 'Weekdays.\n');
  const api = createDevApi({
    root,
    base: '/_vesper/api/',
    model: () => Promise.resolve({ manifest, schemas, markdocConfig, mdxProps: new Map() }),
  });
  server = createServer((req, res) => {
    api(req, res, () => {
      res.statusCode = 404;
      res.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}/_vesper/api`;
});

afterAll(() => {
  server.close();
  rmSync(root, { recursive: true, force: true });
});

const studio = { 'X-Vesper': '1' };

describe('refusal', () => {
  const req = (headers: Record<string, string>) => ({ headers }) as unknown as IncomingMessage;
  const ok = { host: 'localhost:4321', 'x-vesper': '1' };

  it('serves the studio on localhost', () => {
    expect(refusal(req(ok), 'summary')).toBeNull();
    expect(refusal(req({ ...ok, host: '127.0.0.1:4321' }), 'summary')).toBeNull();
    expect(refusal(req({ ...ok, host: '[::1]:4321' }), 'summary')).toBeNull();
    expect(refusal(req({ ...ok, 'sec-fetch-site': 'same-origin' }), 'summary')).toBeNull();
    expect(refusal(req({ ...ok, origin: 'http://localhost:4321' }), 'summary')).toBeNull();
  });

  it('refuses other hosts, other sites and requests without the header', () => {
    expect(refusal(req({ ...ok, host: 'evil.example' }), 'summary')).toMatch(/localhost/);
    expect(refusal(req({ ...ok, host: '192.168.1.5:4321' }), 'summary')).toMatch(/localhost/);
    // Another dev server on this machine is same-site, but not same-origin.
    expect(refusal(req({ ...ok, 'sec-fetch-site': 'same-site' }), 'summary')).toMatch(
      /other sites/,
    );
    expect(refusal(req({ ...ok, origin: 'http://localhost:4400' }), 'summary')).toMatch(/origins/);
    expect(refusal(req({ host: 'localhost:4321' }), 'summary')).toMatch(/X-Vesper/);
  });

  it('lets same-origin images load without the header, and nothing cross-site', () => {
    expect(refusal(req({ host: 'localhost:4321' }), 'file')).toBeNull();
    expect(
      refusal(req({ host: 'localhost:4321', 'sec-fetch-site': 'cross-site' }), 'file'),
    ).toMatch(/other sites/);
  });
});

describe('the dev API', () => {
  it('refuses requests without the studio header', async () => {
    const response = await fetch(`${base}/summary`);
    expect(response.status).toBe(403);
  });

  it('lists, reads and saves entries on disk', async () => {
    expect(await (await fetch(`${base}/summary`, { headers: studio })).json()).toMatchObject([
      { collection: 'blog', count: 1 },
      { collection: 'docs', count: 1 },
    ]);
    const doc = (await (
      await fetch(`${base}/entry?collection=blog&id=hello`, { headers: studio })
    ).json()) as { version: string; data: object };
    expect(doc).toMatchObject({ id: 'hello', data: { title: 'Hello' }, body: '\nBody\n' });

    const saved = await fetch(`${base}/entry`, {
      method: 'PUT',
      headers: { ...studio, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        collection: 'blog',
        id: 'hello',
        version: doc.version,
        data: { title: 'Hi' },
      }),
    });
    expect(saved.status).toBe(200);
    expect(readFileSync(join(root, 'src/content/blog/hello.md'), 'utf8')).toBe(
      '---\ntitle: Hi\n---\nBody\n',
    );
  });

  it('validates with the site’s schema and answers conflicts with 409', async () => {
    const invalid = await fetch(`${base}/entry`, {
      method: 'PUT',
      headers: studio,
      body: JSON.stringify({ collection: 'blog', id: 'hello', version: 'x', data: { title: '' } }),
    });
    expect(invalid.status).toBe(422);
    expect(await invalid.json()).toEqual({
      ok: false,
      reason: 'invalid',
      issues: [{ path: ['title'], message: 'This can’t be empty.' }],
    });

    const stale = await fetch(`${base}/entry`, {
      method: 'PUT',
      headers: studio,
      body: JSON.stringify({
        collection: 'blog',
        id: 'hello',
        version: 'stale',
        data: { title: 'X' },
      }),
    });
    expect(stale.status).toBe(409);
  });

  it('refuses a body the site couldn’t build, using the real Markdoc config', async () => {
    const read = await fetch(`${base}/entry?collection=docs&id=intro`, { headers: studio });
    const doc = (await read.json()) as { version: string };
    const save = (body: string) =>
      fetch(`${base}/entry`, {
        method: 'PUT',
        headers: studio,
        body: JSON.stringify({ collection: 'docs', id: 'intro', version: doc.version, body }),
      });
    const missing = await save('\n{% youtube id="abc" /%}\n');
    expect(missing.status).toBe(422);
    expect(await missing.json()).toMatchObject({
      reason: 'invalid',
      bodyIssues: [{ line: 2, level: 'error', message: 'YouTube video: Title is required.' }],
    });
    const custom = await save('\n{% youtube id="banned" title="T" /%}\n');
    expect(await custom.json()).toMatchObject({
      bodyIssues: [{ level: 'error', message: 'YouTube video: That video is gone.' }],
    });
    const partial = await save('\n{% partial file="_gone.mdoc" /%}\n');
    expect(await partial.json()).toMatchObject({ bodyIssues: [{ code: 'partial-missing' }] });
    expect(readFileSync(join(root, 'src/content/docs/intro.mdoc'), 'utf8')).toBe(
      '---\ntitle: Intro\n---\nHi.\n',
    );
    const fine = await save(
      '\n{% youtube id="abc" title="T" /%}\n\n{% partial file="_hours.mdoc" /%}\n',
    );
    expect(fine.status).toBe(200);
  });

  it('lists the files a partial can point at', async () => {
    const res = await fetch(`${base}/partials`, { headers: studio });
    expect(await res.json()).toEqual([
      'src/content/blog/hello.md',
      'src/content/docs/_hours.mdoc',
      'src/content/docs/intro.mdoc',
    ]);
  });

  it('answers 404 for unknown collections and entries', async () => {
    expect((await fetch(`${base}/entries?collection=nope`, { headers: studio })).status).toBe(404);
    expect((await fetch(`${base}/entry?collection=blog&id=nope`, { headers: studio })).status).toBe(
      404,
    );
  });

  it('serves media files only, and never escapes the site', async () => {
    const image = await fetch(`${base}/file?path=src/assets/dot.png`);
    expect(image.status).toBe(200);
    expect(image.headers.get('content-type')).toBe('image/png');
    expect((await fetch(`${base}/file?path=.env`)).status).toBe(404);
    expect((await fetch(`${base}/file?path=../secret.png`)).status).toBe(400);
  });
});
