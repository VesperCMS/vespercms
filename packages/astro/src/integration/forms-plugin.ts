import { appendFile, mkdir } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import type { CloudStudioSettings } from '@vespercms/core';
import {
  FORM_REFUSALS,
  FORM_STATUS,
  MAX_FORM_BODY,
  backAddress,
  formPage,
  readSubmission,
  sentAddress,
  wantsJson,
  type FormAnswer,
  type FormConfigResponse,
} from '@vespercms/core/forms';
import type { Plugin } from 'vite';
import type { SiteModelCache } from './site-model.ts';

/*
 * `virtual:vesper/forms` gives <Form> the site's forms from the manifest and
 * where they post (spec §6.13): the cloud's API at build when the site has a
 * project, nowhere without one (the form says it isn't connected), and the
 * dev server in `astro dev`.
 *
 * In `astro dev` a post is checked with core's `readSubmission` and kept in
 * `.vesper/forms/<form>.jsonl`, and nothing is sent (DECISIONS.md, "Phase
 * 6a's calls", call 10). It answers like the cloud, so a developer can try a
 * form, with JavaScript or without, before the site is connected. It takes
 * posts only from pages on this machine.
 */

const FORMS = 'virtual:vesper/forms';
const LOCAL = new Set(['localhost', '127.0.0.1', '[::1]']);

export function formsPlugin(options: {
  cache: SiteModelCache;
  /** Astro's `base`, with a trailing slash. */
  base: string;
  root: string;
  dev: boolean;
  cloud: () => CloudStudioSettings | null;
}): Plugin {
  const devBase = `${options.base}_vesper/forms`;
  return {
    name: 'vesper:forms',
    resolveId(id) {
      return id === FORMS ? `\0${FORMS}` : null;
    },
    async load(id) {
      if (id !== `\0${FORMS}`) return null;
      const { manifest } = await options.cache.get();
      const cloud = options.dev ? null : options.cloud();
      const endpoint = options.dev
        ? devBase
        : cloud
          ? `${cloud.api}/forms/${encodeURIComponent(cloud.project)}`
          : null;
      const value = {
        endpoint,
        manifest: manifest.hash,
        definitions: Object.fromEntries(manifest.forms.map((form) => [form.name, form])),
      };
      return `export const forms = ${JSON.stringify(value)};`;
    },
    configureServer(server) {
      if (!options.dev) return;
      server.middlewares.use((req, res, next) => {
        const url = new URL(req.url ?? '/', 'http://localhost');
        if (!url.pathname.startsWith(`${devBase}/`)) {
          next();
          return;
        }
        const name = decodeURIComponent(url.pathname.slice(devBase.length + 1));
        devForm(req, res, name).catch((error: unknown) => {
          server.config.logger.error(
            `Forms: ${error instanceof Error ? error.message : String(error)}`,
          );
          json(res, FORM_STATUS.unavailable, {
            ok: false,
            error: 'unavailable',
            message: FORM_REFUSALS.unavailable,
          });
        });
      });

      async function devForm(req: IncomingMessage, res: ServerResponse, name: string) {
        const host = req.headers.host ?? '';
        const hostname = host.replace(/:\d+$/, '');
        const origin = req.headers.origin;
        if (!LOCAL.has(hostname) || (origin !== undefined && origin !== `http://${host}`)) {
          json(res, FORM_STATUS.refused, {
            ok: false,
            error: 'refused',
            message: FORM_REFUSALS.refused,
          });
          return;
        }
        if (name === 'config' && req.method === 'GET') {
          json(res, 200, { paused: [] } satisfies FormConfigResponse);
          return;
        }
        const { manifest } = await options.cache.get();
        const form = manifest.forms.find((one) => one.name === name);
        if (!form || req.method !== 'POST') {
          json(res, FORM_STATUS['not-found'], {
            ok: false,
            error: 'not-found',
            message: FORM_REFUSALS['not-found'],
          });
          return;
        }
        const text = await bodyOf(req);
        if (text === null) {
          json(res, FORM_STATUS['too-large'], {
            ok: false,
            error: 'too-large',
            message: FORM_REFUSALS['too-large'],
          });
          return;
        }
        const read = readSubmission(form, new URLSearchParams(text));
        const asJson = wantsJson(req.headers.accept ?? null);
        const site = origin ?? `http://${host}`;
        if (read.issues.length > 0 && !read.honeypot) {
          if (asJson) {
            json(res, FORM_STATUS.invalid, {
              ok: false,
              error: 'invalid',
              message: FORM_REFUSALS.invalid,
              issues: read.issues,
            });
          } else {
            res.writeHead(FORM_STATUS.invalid, { 'content-type': 'text/html; charset=utf-8' });
            res.end(
              formPage(form, {
                action: `${devBase}/${encodeURIComponent(name)}`,
                back: backAddress(read.page, site),
                ...(read.page === null ? {} : { page: read.page }),
                ...(read.manifest === null ? {} : { manifest: read.manifest }),
                values: read.values,
                issues: read.issues,
              }),
            );
          }
          return;
        }
        if (!read.honeypot) {
          const folder = join(options.root, '.vesper', 'forms');
          await mkdir(folder, { recursive: true });
          await appendFile(
            join(folder, `${name}.jsonl`),
            `${JSON.stringify({ at: new Date().toISOString(), values: read.values })}\n`,
          );
          server.config.logger.info(
            `Forms: a "${name}" submission is kept in .vesper/forms/${name}.jsonl. Nothing is sent in astro dev.`,
            { timestamp: true },
          );
        }
        if (asJson) json(res, 200, { ok: true });
        else {
          res.writeHead(303, { location: sentAddress(read.page, site, name) });
          res.end();
        }
      }
    },
  };
}

function json(res: ServerResponse, status: number, body: FormAnswer | FormConfigResponse) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

/** The body as text, or null once it's past the cap. */
async function bodyOf(req: IncomingMessage): Promise<string | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
    size += buffer.length;
    if (size > MAX_FORM_BODY) return null;
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}
