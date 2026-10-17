// Spike S0, kept as a regression test: Node itself (not just Vite) must
// resolve workspace packages to TypeScript source under the @vesper/source
// condition and run them through its built-in type stripping. Astro loads
// astro.config.mjs with a plain Node import first, so this is the path a
// site's config takes when it imports @vesper/astro from this workspace.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

function runNode(args) {
  const env = { ...process.env };
  delete env.NODE_OPTIONS;
  return spawnSync(process.execPath, args, { cwd: repoRoot, env, encoding: 'utf8' });
}

describe('@vesper/source condition in plain Node', () => {
  it('resolves @vesper/core to src/index.ts and runs it', () => {
    const script = [
      "const url = import.meta.resolve('@vesper/core');",
      "const mod = await import('@vesper/core');",
      'console.log(JSON.stringify({ url, version: mod.MANIFEST_VERSION }));',
    ].join('\n');
    const result = runNode(['--conditions=@vesper/source', '--input-type=module', '-e', script]);
    expect(result.stderr).not.toMatch(/Error/);
    expect(result.status).toBe(0);
    const out = JSON.parse(result.stdout.trim().split('\n').at(-1));
    expect(out.url).toMatch(/\/packages\/core\/src\/index\.ts$/);
    expect(out.version).toBe(1);
  });
});
