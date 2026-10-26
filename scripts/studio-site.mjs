// A throwaway copy of the playground for the studio's end-to-end tests, which
// save, upload and delete files. The copy sits at the playground's depth in
// the repo (e2e/.studio-site), so its relative imports and the workspace's
// node_modules resolve the same way, and it's gitignored.
//
// Usage: node scripts/studio-site.mjs [--serve <port>] [--site <folder>]
//   --serve runs `astro dev` on the copy after making it.
//   --site names the copy's folder in e2e/ (default .studio-site). The home
//   page's screenshots (`npm run screens`) use their own, so they never wipe
//   the copy a running `npm run e2e` is saving into.
import { spawn } from 'node:child_process';
import { cpSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const source = join(root, 'apps', 'playground');
const siteFlag = process.argv.indexOf('--site');
const folder = siteFlag === -1 ? '.studio-site' : (process.argv[siteFlag + 1] ?? '');
// A dot folder directly in e2e/, listed in .gitignore, .prettierignore,
// eslint.config.js and e2e/tsconfig.json like every copy of the playground.
if (!/^\.[a-z][a-z-]*$/.test(folder)) throw new Error(`studio-site: bad --site "${folder}"`);
const target = join(root, 'e2e', folder);
const SKIP = new Set(['node_modules', 'dist', '.astro', '.vesper']);

rmSync(target, { recursive: true, force: true });
cpSync(source, target, {
  recursive: true,
  filter: (path) => !path.split(/[\\/]/).some((part) => SKIP.has(part)),
});
if (!existsSync(join(target, 'astro.config.mjs'))) throw new Error('studio-site: copy failed');
console.log(`studio-site: copied the playground to ${target}`);

const serve = process.argv.indexOf('--serve');
if (serve !== -1) {
  const port = process.argv[serve + 1] ?? '4401';
  const astro = join(root, 'node_modules', 'astro', 'bin', 'astro.mjs');
  // The workspace's @vesper/* packages resolve to source, as in `npm run dev`.
  // --ignore-lock keeps the server attached: under an AI agent on macOS and
  // Linux, Astro 7 otherwise starts it in the background and returns, and
  // Playwright reads that as the server exiting.
  const child = spawn(
    process.execPath,
    [
      '--conditions=@vesper/source',
      astro,
      'dev',
      '--root',
      target,
      '--port',
      port,
      '--ignore-lock',
    ],
    { stdio: 'inherit', cwd: root },
  );
  const stop = () => {
    child.kill();
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  child.on('exit', (code) => process.exit(code ?? 0));
}
