import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { request } from 'node:http';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createStaticServer } from './static-server.mjs';

let root;
let server;
let origin;

function serve(base) {
  return new Promise((resolve) => {
    const instance = createStaticServer({ root, base });
    instance.listen(0, '127.0.0.1', () => {
      resolve({ instance, origin: `http://127.0.0.1:${instance.address().port}` });
    });
  });
}

const get = (path, init) => fetch(`${origin}${path}`, { redirect: 'manual', ...init });

// fetch() normalizes dot segments away, so traversal has to be sent raw.
function rawStatus(path) {
  return new Promise((resolve, reject) => {
    const req = request(`${origin}/`, { path }, (res) => {
      res.resume();
      resolve(res.statusCode);
    });
    req.on('error', reject);
    req.end();
  });
}

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'vesper-static-'));
  mkdirSync(join(root, 'blog', 'post'), { recursive: true });
  mkdirSync(join(root, 'empty'));
  writeFileSync(join(root, 'index.html'), '<h1>home</h1>');
  writeFileSync(join(root, '404.html'), '<h1>missing</h1>');
  writeFileSync(join(root, 'blog', 'post', 'index.html'), '<h1>post</h1>');
  writeFileSync(join(root, 'page.html'), '<h1>flat</h1>');
  writeFileSync(join(root, 'style.css'), 'body{}');
  writeFileSync(join(root, 'search.wasm'), 'wasm');
  ({ instance: server, origin } = await serve('/'));
});

afterAll(() => {
  server.close();
  rmSync(root, { recursive: true, force: true });
});

describe('static-server', () => {
  it('serves a directory index for a trailing-slash URL', async () => {
    const response = await get('/blog/post/');
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('<h1>post</h1>');
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
  });

  it('301s a directory URL without a slash to the slash form, like Apache', async () => {
    const response = await get('/blog/post?x=1');
    expect(response.status).toBe(301);
    expect(response.headers.get('location')).toBe('/blog/post/?x=1');
  });

  it('serves files by exact name and never guesses .html', async () => {
    expect((await get('/page.html')).status).toBe(200);
    expect((await get('/page')).status).toBe(404);
  });

  it('answers unknown paths with 404 and the site 404 page', async () => {
    const response = await get('/nope/');
    expect(response.status).toBe(404);
    expect(await response.text()).toBe('<h1>missing</h1>');
    expect((await get('/empty')).status).toBe(404);
    expect((await get('/empty/')).status).toBe(404);
  });

  it('sets only Content-Type and Content-Length', async () => {
    const response = await get('/style.css');
    expect(response.headers.get('content-type')).toBe('text/css; charset=utf-8');
    expect(response.headers.get('cache-control')).toBeNull();
    expect((await get('/search.wasm')).headers.get('content-type')).toBe('application/wasm');
  });

  it('refuses path traversal and methods other than GET and HEAD', async () => {
    expect(await rawStatus('/../../../../etc/hosts')).toBe(404);
    expect(await rawStatus('/%2e%2e/%2e%2e/%2e%2e/etc/hosts')).toBe(404);
    expect(await rawStatus('/..%5c..%5c..%5cWindows%5cwin.ini')).toBe(404);
    expect((await get('/', { method: 'POST' })).status).toBe(405);
    const head = await get('/', { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe('');
  });

  it('serves a site built for a subfolder under --base', async () => {
    const { instance, origin: subOrigin } = await serve('/sub/');
    try {
      expect((await fetch(`${subOrigin}/sub/blog/post/`)).status).toBe(200);
      expect((await fetch(`${subOrigin}/blog/post/`, { redirect: 'manual' })).status).toBe(404);
      const bare = await fetch(`${subOrigin}/sub`, { redirect: 'manual' });
      expect(bare.status).toBe(301);
      expect(bare.headers.get('location')).toBe('/sub/');
    } finally {
      instance.close();
    }
  });
});
