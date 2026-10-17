import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  ContentService,
  MEDIA_TYPES,
  MediaService,
  extensionOf,
  normalizePath,
  type SaveRequest,
} from '@vesper/core';
import { bodyValidator, schemaValidator, type SiteModel } from '../node/manifest.ts';
import { LocalStorage } from '../node/storage-local.ts';

/*
 * Local mode's back end (spec §6.7): the studio's API, served by the dev
 * server at `<base>_vesper/api/*`, reading and writing files on disk. Astro's
 * content layer sees the writes and hot-reloads the site.
 *
 * There is no sign-in, so it refuses anything that didn't come from the
 * studio itself, on this machine:
 * - the Host header must be localhost (this also defeats DNS rebinding);
 * - `Sec-Fetch-Site`, when the browser sends it, must be same-origin, and
 *   an `Origin` header must match the host, so another site open in the
 *   same browser (even another dev server on localhost) can't use it;
 * - every request but file reads (`<img src>` can't send headers) must carry
 *   `X-Vesper: 1`, which forces a CORS preflight on cross-origin requests.
 */

export type DevApiOptions = {
  root: string;
  /** Where the API is mounted, with a trailing slash, e.g. `/_vesper/api/`. */
  base: string;
  model: () => Promise<SiteModel>;
};

type Handler = (req: IncomingMessage, res: ServerResponse, next: (error?: unknown) => void) => void;

const MAX_BODY = 25 * 1024 * 1024;

export function createDevApi(options: DevApiOptions): Handler {
  const storage = new LocalStorage(options.root);
  const base = options.base.endsWith('/') ? options.base : `${options.base}/`;

  return (req, res, next) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (!url.pathname.startsWith(base)) {
      next();
      return;
    }
    const route = url.pathname.slice(base.length);
    const refused = refusal(req, route);
    if (refused) {
      send(res, 403, { message: refused });
      return;
    }
    handle(req, res, route, url.searchParams).catch((error: unknown) => {
      send(res, 500, { message: error instanceof Error ? error.message : String(error) });
    });
  };

  async function handle(
    req: IncomingMessage,
    res: ServerResponse,
    route: string,
    query: URLSearchParams,
  ): Promise<void> {
    const method = req.method ?? 'GET';
    if (route === 'file' && (method === 'GET' || method === 'HEAD')) {
      await serveFile(res, query.get('path') ?? '', method === 'HEAD');
      return;
    }

    const model = await options.model();
    const service: ContentService = new ContentService(storage, model.manifest, {
      validate: schemaValidator(model.schemas),
      validateBody: bodyValidator(model, () => service.listPartials()),
    });
    // Media lives in <srcDir>/assets and public/ (spec §6.6.1).
    const media = () =>
      new MediaService(storage, service, {
        roots: [`${model.manifest.site.srcDir}/assets`, 'public'],
      });
    const collection = query.get('collection') ?? '';
    const known = model.manifest.collections.some((c) => c.name === collection);

    if (route === 'summary' && method === 'GET') {
      send(res, 200, await service.summary());
    } else if (route === 'entries' && method === 'GET') {
      if (!known) send(res, 404, { message: `There's no collection called "${collection}".` });
      else send(res, 200, await service.listEntries(collection));
    } else if (route === 'entry' && method === 'GET') {
      const id = query.get('id') ?? '';
      const doc = known ? await service.readEntry(collection, id) : null;
      if (doc) send(res, 200, doc);
      else send(res, 404, { message: `"${id}" wasn't found in ${collection || 'this site'}.` });
    } else if (route === 'entry' && method === 'PUT') {
      const request = (await readJson(req)) as SaveRequest;
      const result = await service.saveEntry(request);
      send(res, statusOf(result), result);
    } else if (route === 'partials' && method === 'GET') {
      send(res, 200, await service.listPartials());
    } else if (route === 'media' && method === 'GET') {
      send(res, 200, await media().list());
    } else if (route === 'media' && method === 'POST') {
      const bytes = new Uint8Array(await readBody(req));
      const result = await media().upload(
        bytes,
        query.get('name') ?? '',
        query.get('folder') ?? '',
      );
      send(res, result.ok ? 200 : 400, result);
    } else if (route === 'media' && method === 'DELETE') {
      const result = await media().remove(query.get('path') ?? '');
      send(res, statusOf(result), result);
    } else if (route === 'entry' && method === 'DELETE') {
      const result = await service.deleteEntry(
        collection,
        query.get('id') ?? '',
        query.get('version') ?? '',
      );
      send(res, statusOf(result), result);
    } else {
      send(res, 404, { message: `Unknown studio request: ${method} ${route}` });
    }
  }

  async function serveFile(res: ServerResponse, path: string, head: boolean): Promise<void> {
    let normalized: string;
    try {
      normalized = normalizePath(path);
    } catch {
      send(res, 400, { message: 'That isn’t a file path in this site.' });
      return;
    }
    // Only media types, never source files, config or secrets.
    const type = MEDIA_TYPES[extensionOf(normalized)];
    const file = type ? await storage.read(normalized) : null;
    if (!type || !file) {
      send(res, 404, { message: `${normalized} wasn't found.` });
      return;
    }
    res.statusCode = 200;
    res.setHeader('Content-Type', type);
    res.setHeader('Content-Length', String(file.bytes.length));
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // An SVG opened directly must not run its scripts on this origin.
    if (type === 'image/svg+xml') res.setHeader('Content-Security-Policy', "script-src 'none'");
    res.end(head ? undefined : file.bytes);
  }
}

/** Why a request is refused, or `null` to serve it. */
export function refusal(req: IncomingMessage, route: string): string | null {
  const host = req.headers.host ?? '';
  const hostname = host
    .replace(/:\d+$/, '')
    .replace(/^\[(.*)\]$/, '$1')
    .toLowerCase();
  const local =
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname === '127.0.0.1' ||
    hostname === '::1';
  if (!local) return 'The Vesper studio API only answers on localhost.';

  const site = header(req, 'sec-fetch-site');
  if (site && site !== 'same-origin' && site !== 'none') {
    return 'Requests from other sites are refused.';
  }
  const origin = header(req, 'origin');
  if (origin) {
    let originHost = '';
    try {
      originHost = new URL(origin).host;
    } catch {
      // An unparseable Origin is refused below.
    }
    if (originHost.toLowerCase() !== host.toLowerCase()) {
      return 'Requests from other origins are refused.';
    }
  }
  if (route !== 'file' && header(req, 'x-vesper') !== '1') {
    return 'Studio requests must carry the X-Vesper header.';
  }
  return null;
}

function header(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function statusOf(result: { ok: boolean; reason?: string }): number {
  if (result.ok) return 200;
  if (result.reason === 'conflict') return 409;
  if (result.reason === 'invalid') return 422;
  return 400;
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(text);
}

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > MAX_BODY) throw new Error('That request is too large.');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const text = (await readBody(req)).toString('utf8');
  return text ? (JSON.parse(text) as unknown) : {};
}
