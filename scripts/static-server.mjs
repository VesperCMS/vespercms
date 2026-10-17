// A deliberately dumb static file server: the "FTP host" of the spec §6.16
// test matrix. It behaves like Apache with no .htaccess, S3 website hosting
// or `python -m http.server`:
//
// - `/x/` serves `x/index.html`.
// - `/x` serves the file `x`. If `x` is a directory with an index, it 301s to `/x/`.
// - Anything else is a 404, with the site's own 404.html as the body.
//
// It does no rewrites, no SPA fallback, no clean-URL guessing, no redirect rules
// and no headers beyond Content-Type and Content-Length. Anything that works
// here works on any static host (D16). `serve` and `sirv` were rejected
// because their clean-URL and SPA modes would hide exactly those bugs.
//
// Usage: node scripts/static-server.mjs <dir> [--port 4400] [--host 127.0.0.1] [--base /sub/]
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.map': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.xml': 'application/xml',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
  '.pdf': 'application/pdf',
};

async function statOrNull(path) {
  try {
    return await stat(path);
  } catch {
    return null;
  }
}

/**
 * @param {{ root: string, base?: string }} options
 * @returns {import('node:http').Server}
 */
export function createStaticServer({ root, base = '/' }) {
  const rootDir = resolve(root);
  const prefix = base.endsWith('/') ? base : `${base}/`;

  async function send(res, method, status, file, headers = {}) {
    const info = await statOrNull(file);
    if (!info?.isFile()) {
      res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', ...headers });
      res.end(status === 404 ? 'Not found' : '');
      return;
    }
    res.writeHead(status, {
      'Content-Type': TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream',
      'Content-Length': info.size,
      ...headers,
    });
    if (method === 'HEAD') res.end();
    else createReadStream(file).pipe(res);
  }

  const notFound = (res, method) => send(res, method, 404, join(rootDir, '404.html'));

  return createServer(async (req, res) => {
    const method = req.method ?? 'GET';
    if (method !== 'GET' && method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD' });
      res.end();
      return;
    }

    const url = new URL(req.url ?? '/', 'http://localhost');
    let pathname;
    try {
      pathname = decodeURIComponent(url.pathname);
    } catch {
      return notFound(res, method);
    }
    if (pathname.includes('\0')) return notFound(res, method);

    if (`${pathname}/` === prefix) {
      res.writeHead(301, { Location: prefix + url.search });
      res.end();
      return;
    }
    if (!pathname.startsWith(prefix)) return notFound(res, method);

    const relative = pathname.slice(prefix.length);
    const target = resolve(rootDir, relative);
    // Refuse anything that escapes the root (`/../`, encoded or not).
    if (target !== rootDir && !target.startsWith(rootDir + sep)) return notFound(res, method);

    if (pathname.endsWith('/')) {
      const index = join(target, 'index.html');
      if ((await statOrNull(index))?.isFile()) return send(res, method, 200, index);
      return notFound(res, method);
    }

    const info = await statOrNull(target);
    if (info?.isFile()) return send(res, method, 200, target);
    if (info?.isDirectory() && (await statOrNull(join(target, 'index.html')))?.isFile()) {
      res.writeHead(301, { Location: `${pathname}/${url.search}` });
      res.end();
      return;
    }
    return notFound(res, method);
  });
}

async function main() {
  const args = process.argv.slice(2);
  const option = (name, fallback) => {
    const index = args.indexOf(`--${name}`);
    return index === -1 ? fallback : args[index + 1];
  };
  const root = args.find((arg, i) => !arg.startsWith('--') && !args[i - 1]?.startsWith('--'));
  if (!root) {
    console.error(
      'Usage: node scripts/static-server.mjs <dir> [--port 4400] [--host 127.0.0.1] [--base /sub/]',
    );
    process.exit(1);
  }
  const port = Number(option('port', '4400'));
  const host = option('host', '127.0.0.1');
  const base = option('base', '/');
  createStaticServer({ root, base }).listen(port, host, () => {
    console.log(
      `Serving ${resolve(root)} at http://${host}:${port}${base} (no rewrites, no headers)`,
    );
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
