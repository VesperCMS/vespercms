import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildManifest } from '@vespercms/core';
import { afterAll, describe, expect, it } from 'vitest';
import { z } from 'astro/zod';
import { formsPlugin } from './forms-plugin.ts';
import type { SiteModelCache } from './site-model.ts';

/*
 * The forms in `astro dev` (DECISIONS.md, "Phase 6a's calls", call 10): the
 * dev server takes a post from a page on this machine, checks it, keeps it
 * in .vesper/forms/ and answers as the cloud does.
 */

type Handler = (req: IncomingMessage, res: ServerResponse, next: () => void) => void;

const root = mkdtempSync(join(tmpdir(), 'vesper-forms-dev-'));
afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

async function devServer(dev = true) {
  const manifest = await buildManifest({
    site: { srcDir: 'src' },
    collections: [],
    forms: [
      {
        name: 'contact',
        schema: z.object({
          name: z.string().min(1).meta({ label: 'Your name' }),
          email: z.email().meta({ label: 'Email' }),
        }),
      },
    ],
  });
  const cache = { get: () => Promise.resolve({ manifest }) } as unknown as SiteModelCache;
  const plugin = formsPlugin({ cache, base: '/', root, dev, cloud: () => null });
  let handler: Handler | null = null;
  const configure = plugin.configureServer as (server: unknown) => void;
  configure({
    middlewares: { use: (fn: Handler) => (handler = fn) },
    config: { logger: { info: () => undefined, error: () => undefined } },
  });
  const server = createServer((req, res) => {
    handler?.(req, res, () => {
      res.writeHead(404).end();
    });
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const { port } = server.address() as AddressInfo;
  const load = plugin.load as (id: string) => Promise<string | null>;
  return {
    url: `http://127.0.0.1:${String(port)}`,
    module: await load('\0virtual:vesper/forms'),
    close: () =>
      new Promise<void>((done) => {
        server.close(() => {
          done();
        });
      }),
  };
}

// Node's fetch sends Host itself: 127.0.0.1, which is this machine.
const post = (server: { url: string }, body: string, headers: Record<string, string> = {}) =>
  fetch(`${server.url}/_vesper/forms/contact`, {
    method: 'POST',
    redirect: 'manual',
    body,
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      ...headers,
    },
  });

describe('forms in astro dev', () => {
  it('points <Form> at the dev server, and at nothing in a build without the cloud', async () => {
    const dev = await devServer();
    expect(dev.module).toContain('"endpoint":"/_vesper/forms"');
    await dev.close();
    const built = await devServer(false);
    expect(built.module).toContain('"endpoint":null');
    expect(built.module).toContain('"contact"');
    await built.close();
  });

  it('keeps a good post on this machine and sends the browser back to the sent message', async () => {
    const server = await devServer();
    const sent = await post(server, 'name=Ada&email=ada%40example.edu&_vesper_page=%2Fcontact%2F', {
      origin: server.url,
    });
    expect(sent.status).toBe(303);
    expect(sent.headers.get('location')).toBe(`${server.url}/contact/#vesper-form-contact-sent`);
    const kept = readFileSync(join(root, '.vesper', 'forms', 'contact.jsonl'), 'utf8')
      .trim()
      .split('\n');
    expect(JSON.parse(kept.at(-1) ?? '{}')).toMatchObject({
      values: { name: 'Ada', email: 'ada@example.edu' },
    });

    const json = await post(server, 'name=Ada&email=ada%40example.edu', {
      accept: 'application/json',
    });
    expect(await json.json()).toEqual({ ok: true });
    await server.close();
  });

  it('answers problems as the cloud does: JSON for the script, the form drawn again without it', async () => {
    const server = await devServer();
    const json = await post(server, 'email=nope', { accept: 'application/json' });
    expect(json.status).toBe(400);
    expect(await json.json()).toMatchObject({
      ok: false,
      error: 'invalid',
      issues: [
        { field: 'name', message: 'This is required.' },
        { field: 'email', message: 'Enter an email address, such as name@example.com.' },
      ],
    });
    const page = await post(server, 'email=nope&_vesper_page=%2Fcontact%2F');
    expect(page.status).toBe(400);
    const html = await page.text();
    expect(html).toContain('There is a problem');
    expect(html).toContain('value="nope"');
    expect(html).toContain('href="http://127.0.0.1');
    await server.close();
  });

  it('takes posts only from pages on this machine', async () => {
    const server = await devServer();
    const elsewhere = await post(server, 'name=Ada', { origin: 'https://evil.example' });
    expect(elsewhere.status).toBe(403);
    await server.close();
  });
});
