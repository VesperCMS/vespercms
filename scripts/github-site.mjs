// The studio in GitHub mode for the end-to-end tests (spec §6.8): a copy of
// the playground built with `vesper({ github })`, published to a fake GitHub
// through the real relay, all on 127.0.0.1:
//
// - 4403: the fake GitHub (scripts/github-fake.mjs), its repository a bare
//   git repo at e2e/.github-site-repo.git seeded with the copy;
// - 4404: the relay (templates/oauth-relay/worker.js), allowing only 4405;
// - 4405: the built site on the plain static server, as any host serves it.
//
// The copy and the repository are gitignored and made fresh each run.
//
// Usage: node scripts/github-site.mjs [--serve]
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import worker from '../templates/oauth-relay/worker.js';
import { createGitHubFake, serveGitHubFake } from './github-fake.mjs';
import { createStaticServer } from './static-server.mjs';

export const PORTS = { github: 4403, relay: 4404, site: 4405 };

const root = fileURLToPath(new URL('..', import.meta.url));
const source = join(root, 'apps', 'playground');
export const target = join(root, 'e2e', '.github-site');
export const repository = join(root, 'e2e', '.github-site-repo.git');
const SKIP = new Set(['node_modules', 'dist', '.astro', '.vesper']);

rmSync(target, { recursive: true, force: true });
rmSync(repository, { recursive: true, force: true });
cpSync(source, target, {
  recursive: true,
  filter: (path) => !path.split(/[\\/]/).some((part) => SKIP.has(part)),
});

const config = join(target, 'astro.config.mjs');
const text = readFileSync(config, 'utf8');
if (!text.includes('vesper({ search })'))
  throw new Error('github-site: astro.config.mjs no longer calls vesper({ search })');
const github = {
  relay: `http://127.0.0.1:${String(PORTS.relay)}`,
  repo: 'vesper/site',
  branch: 'main',
  root: '',
  apiUrl: `http://127.0.0.1:${String(PORTS.github)}`,
};
writeFileSync(
  config,
  text.replace('vesper({ search })', `vesper({ search, github: ${JSON.stringify(github)} })`),
);

// Built as a host would build it, without this process's test variables.
const env = Object.fromEntries(
  Object.entries(process.env).filter(
    ([key]) => !/^(VITEST.*|NODE_ENV|DEV|PROD|MODE|SSR|BASE_URL|TEST)$/.test(key),
  ),
);
const astro = join(root, 'node_modules', 'astro', 'bin', 'astro.mjs');
const build = spawnSync(
  process.execPath,
  ['--conditions=@vesper/source', astro, 'build', '--root', target],
  {
    cwd: root,
    env,
    stdio: ['ignore', 'pipe', 'inherit'],
    encoding: 'utf8',
  },
);
if (build.status !== 0) {
  console.log(build.stdout);
  throw new Error('github-site: the build failed');
}
for (const line of build.stdout.split('\n')) if (/GitHub mode/.test(line)) console.log(line.trim());
if (!existsSync(join(target, 'dist', '_vesper', 'schemas.js'))) {
  throw new Error('github-site: the schemas for the browser weren’t built');
}

const fake = createGitHubFake({ dir: repository });
fake.seedFolder(target);
console.log(`github-site: built ${target} and seeded ${repository}`);

if (process.argv.includes('--serve')) {
  await serveGitHubFake(fake, PORTS.github);
  const relayEnv = {
    GITHUB_CLIENT_ID: 'Iv1.e2e',
    GITHUB_CLIENT_SECRET: 'e2e-secret',
    ALLOWED_ORIGINS: `http://127.0.0.1:${String(PORTS.site)}`,
    GITHUB_URL: `http://127.0.0.1:${String(PORTS.github)}`,
  };
  await serveFetch((request) => worker.fetch(request, relayEnv), PORTS.relay);
  await new Promise((resolve) =>
    createStaticServer({ root: join(target, 'dist') }).listen(PORTS.site, '127.0.0.1', resolve),
  );
  console.log(
    `github-site: GitHub on ${String(PORTS.github)}, the relay on ${String(PORTS.relay)}, the site on http://127.0.0.1:${String(PORTS.site)}/`,
  );
}

/** Serves a fetch handler over HTTP, as Workers' runtime would. */
function serveFetch(handler, port) {
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = chunks.length > 0 ? Buffer.concat(chunks) : undefined;
    const request = new Request(`http://${req.headers.host}${req.url}`, {
      method: req.method,
      headers: Object.entries(req.headers).flatMap(([key, value]) =>
        Array.isArray(value)
          ? value.map((v) => [key, v])
          : value === undefined
            ? []
            : [[key, value]],
      ),
      ...(body && req.method !== 'GET' && req.method !== 'HEAD' ? { body } : {}),
    });
    const response = await handler(request);
    res.statusCode = response.status;
    response.headers.forEach((value, key) => res.setHeader(key, value));
    res.end(Buffer.from(await response.arrayBuffer()));
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}
