// A throwaway copy of the playground for the studio's end-to-end tests, which
// save, upload and delete files. The copy sits at the playground's depth in
// the repo (e2e/.studio-site), so its relative imports and the workspace's
// node_modules resolve the same way, and it's gitignored.
//
// Usage: node scripts/studio-site.mjs [--serve <port>]
//   --serve runs `astro dev` on the copy after making it.
import { spawn } from 'node:child_process';
import { cpSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const source = join(root, 'apps', 'playground');
const target = join(root, 'e2e', '.studio-site');
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
  const child = spawn(
    process.execPath,
    ['--conditions=@vesper/source', astro, 'dev', '--root', target, '--port', port],
    { stdio: 'inherit', cwd: root },
  );
  const stop = () => {
    child.kill();
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  child.on('exit', (code) => process.exit(code ?? 0));
}
