// The studio connected to the cloud for the end-to-end tests (spec §6.9): a
// copy of the playground built with `vesper({ cloud })`, its drafts kept by a
// fake cloud that publishes to a fake GitHub over real git, all on 127.0.0.1:
//
// - 4406: the fake cloud (scripts/cloud-fake.mjs): the app under /app, the API
//   under /api, and a control API under /__test for the tests. Its repository
//   is a bare git repo at e2e/.cloud-site-repo.git seeded with the copy.
// - 4407: the built site on the plain static server, as any host serves it.
//
// The copy and the repository are gitignored and made fresh each run.
//
// Usage: node scripts/cloud-site.mjs [--serve]
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCloudFake, serveCloudFake } from './cloud-fake.mjs';
import { createGitHubFake } from './github-fake.mjs';
import { createStaticServer } from './static-server.mjs';

export const PORTS = { cloud: 4406, site: 4407 };
const CLOUD = `http://127.0.0.1:${String(PORTS.cloud)}`;
const SITE = `http://127.0.0.1:${String(PORTS.site)}`;

const root = fileURLToPath(new URL('..', import.meta.url));
const source = join(root, 'apps', 'playground');
export const target = join(root, 'e2e', '.cloud-site');
export const repository = join(root, 'e2e', '.cloud-site-repo.git');
const SKIP = new Set(['node_modules', 'dist', '.astro', '.vesper']);

/** The site's members, by role, as a site admin would have set them up in the dashboard. */
export const PEOPLE = [
  { id: 'u_admin', name: 'Ada Admin', email: 'ada@example.edu', role: 'admin', picture: true },
  { id: 'u_contributor', name: 'Cal Contributor', email: 'cal@example.edu', role: 'contributor' },
  {
    id: 'u_nurse',
    name: 'Nia Nursing',
    email: 'nia@example.edu',
    role: 'editor',
    grants: [{ collection: 'pages', match: 'academics/nursing/**' }],
  },
  { id: 'u_viewer', name: 'Vi Viewer', email: 'vi@example.edu', role: 'viewer' },
];

rmSync(target, { recursive: true, force: true });
rmSync(repository, { recursive: true, force: true });
cpSync(source, target, {
  recursive: true,
  filter: (path) => !path.split(/[\\/]/).some((part) => SKIP.has(part)),
});

const config = join(target, 'astro.config.mjs');
const text = readFileSync(config, 'utf8');
if (!text.includes('vesper({ search })'))
  throw new Error('cloud-site: astro.config.mjs no longer calls vesper({ search })');
const cloudOptions = { project: 'site_playground', app: `${CLOUD}/app`, api: `${CLOUD}/api` };
writeFileSync(
  config,
  text.replace('vesper({ search })', `vesper({ search, cloud: ${JSON.stringify(cloudOptions)} })`),
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
  { cwd: root, env, stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8' },
);
if (build.status !== 0) {
  console.log(build.stdout);
  throw new Error('cloud-site: the build failed');
}
for (const line of build.stdout.split('\n')) if (/Cloud:/.test(line)) console.log(line.trim());
if (!existsSync(join(target, 'dist', '_vesper', 'schemas.js'))) {
  throw new Error('cloud-site: the schemas for the browser weren’t built');
}

const github = createGitHubFake({ dir: repository, login: 'vesper[bot]' });
github.seedFolder(target);
console.log(`cloud-site: built ${target} and seeded ${repository}`);

if (process.argv.includes('--serve')) {
  const manifest = JSON.parse(
    readFileSync(join(target, 'dist', '_vesper', 'manifest.json'), 'utf8'),
  );
  const cloud = createCloudFake({
    github,
    manifest,
    site: { id: 'site_playground', name: 'Playground', origins: [SITE] },
    people: PEOPLE,
    base: CLOUD,
  });
  await serveCloudFake(cloud, PORTS.cloud, '127.0.0.1', { control: true });
  await new Promise((resolve) =>
    createStaticServer({ root: join(target, 'dist') }).listen(PORTS.site, '127.0.0.1', resolve),
  );
  console.log(`cloud-site: the cloud on ${CLOUD}, the site on ${SITE}/`);
}
