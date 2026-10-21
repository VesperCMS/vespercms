import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

// `vesper agents` on the real playground: it loads the site through Vite like
// `vesper manifest`, writes between its markers and leaves the rest alone.
const repo = fileURLToPath(new URL('../../../', import.meta.url));
const cli = join(repo, 'packages', 'astro', 'src', 'node', 'cli.ts');
const playground = join(repo, 'apps', 'playground');
const dir = mkdtempSync(join(tmpdir(), 'vesper-agents-'));
const file = join(dir, 'AGENTS.md');

const vesper = (...args: string[]) =>
  spawnSync(process.execPath, ['--conditions=@vesper/source', cli, ...args], {
    cwd: repo,
    encoding: 'utf8',
  });

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('vesper agents', () => {
  it('writes, checks and rewrites the site’s section of AGENTS.md', () => {
    const own = '# Playground\n\nUse npm, never pnpm.\n';
    writeFileSync(file, own);

    const write = vesper('agents', '--root', playground, '--file', file);
    expect(write.status, write.stderr).toBe(0);
    expect(write.stdout).toContain('Updated');
    const written = readFileSync(file, 'utf8');
    expect(written.startsWith(`${own}\n<!-- vesper:agents:start -->\n`)).toBe(true);
    expect(written).toContain('#### Blog posts (`blog`)');
    expect(written.trimEnd().endsWith('<!-- vesper:agents:end -->')).toBe(true);

    const fresh = vesper('agents', '--root', playground, '--file', file, '--check');
    expect(fresh.status, fresh.stderr).toBe(0);
    expect(fresh.stdout).toContain('is up to date');

    const stale = written.replace('#### Blog posts', '#### Old posts');
    writeFileSync(file, stale);
    const check = vesper('agents', '--root', playground, '--file', file, '--check');
    expect(check.status).toBe(1);
    expect(check.stderr).toContain('is out of date');
    expect(readFileSync(file, 'utf8')).toBe(stale);

    const again = vesper('agents', '--root', playground, '--file', file);
    expect(again.status, again.stderr).toBe(0);
    expect(readFileSync(file, 'utf8')).toBe(written);
  }, 180_000);
});
