import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { indexSearch } from './search.ts';

/*
 * Pagefind 1.5.2's service as far as writing goes, without the timing luck:
 * `writeFiles` creates each file and answers before its bytes land, and
 * `close()` kills the service with the writes still pending. A Windows CI run
 * shipped an empty `pagefind-entry.json` that way (DECISIONS.md, "Vesper
 * writes Pagefind's files itself"). `getFiles` hands back the bytes.
 */
vi.mock('pagefind', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const bytes = (text: string) => new TextEncoder().encode(text);
  const files = [
    {
      path: 'pagefind-entry.json',
      content: bytes(
        JSON.stringify({
          version: '1.5.2',
          languages: { en: { hash: 'en_1', wasm: 'en', page_count: 1 } },
        }),
      ),
    },
    { path: 'pagefind.js', content: bytes('x'.repeat(4000)) },
    { path: 'pagefind-ui.js', content: bytes('ui') },
    { path: 'index/en_a.pf_index', content: bytes('x'.repeat(300)) },
  ];
  const pending = new Set<ReturnType<typeof setTimeout>>();
  return {
    createIndex: () =>
      Promise.resolve({
        errors: [],
        index: {
          addHTMLFile: () => Promise.resolve({ errors: [] }),
          getFiles: () => Promise.resolve({ errors: [], files }),
          writeFiles: ({ outputPath }: { outputPath: string }) => {
            for (const file of files) {
              const target = path.join(outputPath, file.path);
              fs.mkdirSync(path.dirname(target), { recursive: true });
              fs.writeFileSync(target, '');
              const write = setTimeout(() => {
                fs.writeFileSync(target, file.content);
              });
              pending.add(write);
            }
            return Promise.resolve({ errors: [], outputPath });
          },
        },
      }),
    close: () => {
      for (const write of pending) clearTimeout(write);
      pending.clear();
      return Promise.resolve(null);
    },
  };
});

describe('writing the index', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it('is whole once the build moves on, though Pagefind answers before its own writes land', async () => {
    const root = mkdtempSync(join(tmpdir(), 'vesper-index-'));
    dirs.push(root);
    const dist = join(root, 'dist');
    mkdirSync(dist, { recursive: true });
    writeFileSync(
      join(dist, 'index.html'),
      '<!doctype html><html lang="en"><head><title>T</title></head><body><main><div data-vesper-search="dialog"></div>Welcome</main></body></html>',
    );
    const result = await indexSearch({
      root,
      dist,
      model: {
        manifest: {
          manifestVersion: 1,
          generator: { name: 'test', version: '0' },
          hash: '',
          site: { srcDir: 'src' },
          collections: [],
          forms: [],
          diagnostics: [],
        },
        schemas: new Map(),
        mdxProps: new Map(),
        widgetNames: [],
      } as never,
      settings: { base: '/', trailingSlash: 'ignore', buildFormat: 'directory' },
      routes: () => new Map(),
      search: {},
    });
    expect(result.built).toBe(true);
    expect(result.warnings).toEqual([]);
    expect(result.info).toEqual([
      'Search: indexed 1 page in 1 language, 0 KB of index. A first search loads 4 KB.',
    ]);
    const out = join(dist, '_vesper/search');
    expect(readFileSync(join(out, 'pagefind.js'), 'utf8')).toBe('x'.repeat(4000));
    expect(readFileSync(join(out, 'index/en_a.pf_index'), 'utf8')).toBe('x'.repeat(300));
    expect(existsSync(join(out, 'pagefind-ui.js'))).toBe(false);
  });
});
