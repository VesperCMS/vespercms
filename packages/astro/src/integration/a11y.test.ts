import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  builtPages,
  issuesOf,
  skipReason,
  summaryLine,
  urlPathOf,
  writeReport,
  type A11yReport,
} from './a11y.ts';

const temps: string[] = [];
afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function site(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'vesper-a11y-'));
  temps.push(root);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(root, path, '..'), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

const report = (errors: number, warnings: number): A11yReport => ({
  version: 1,
  generator: '@vesper/astro',
  note: '',
  checked: { pages: 3, skipped: { redirects: 1, studio: 1 }, engine: 'axe', rules: [] },
  summary: { errors, warnings, pages: errors + warnings > 0 ? 1 : 0 },
  pages: [],
});

describe('built pages', () => {
  it('lists every HTML file with its URL, base included, but not assets or Vesper’s files', () => {
    const root = site({
      'dist/index.html': '',
      'dist/404.html': '',
      'dist/blog/welcome/index.html': '',
      'dist/about.html': '',
      'dist/_astro/chunk.html': '',
      'dist/_vesper/x.html': '',
    });
    expect(builtPages(join(root, 'dist'), '/')).toEqual([
      { file: '404.html', url: '/404' },
      { file: 'about.html', url: '/about' },
      { file: 'blog/welcome/index.html', url: '/blog/welcome/' },
      { file: 'index.html', url: '/' },
    ]);
    expect(builtPages(join(root, 'dist'), '/docs').map((p) => p.url)).toContain(
      '/docs/blog/welcome/',
    );
  });

  it('turns files into URL paths for both build formats', () => {
    expect(urlPathOf('index.html')).toBe('');
    expect(urlPathOf('a/b/index.html')).toBe('a/b/');
    expect(urlPathOf('a/b.html')).toBe('a/b');
  });

  it('skips Astro’s redirect pages and the studio shell', () => {
    expect(
      skipReason(
        'old/index.html',
        '<!doctype html><meta http-equiv="refresh" content="0;url=/new/">',
      ),
    ).toBe('redirect');
    expect(skipReason('admin/index.html', '<html lang="en"></html>')).toBe('studio');
    expect(skipReason('about/index.html', '<html lang="en"></html>')).toBeNull();
  });
});

describe('issues', () => {
  it('speaks the studio’s language, with axe’s impact as error or warning', () => {
    const issues = issuesOf([
      {
        id: 'image-alt',
        impact: 'critical',
        helpUrl: 'https://dequeuniversity.com/rules/axe/4.14/image-alt?application=axeAPI',
        nodes: [{ target: ['main > img'], html: '<img src="/a.png">' }],
      },
      {
        id: 'heading-order',
        impact: 'moderate',
        helpUrl: 'https://dequeuniversity.com/rules/axe/4.14/heading-order',
        nodes: [{ target: ['#x'], html: `<h4 id="x">${'x'.repeat(300)}</h4>` }],
      },
    ]);
    expect(issues[0]).toEqual({
      rule: 'image-alt',
      level: 'error',
      message: 'Describe this image, or mark it decorative.',
      why: 'Screen readers announce an image with no description by its file name, or not at all.',
      help: 'https://dequeuniversity.com/rules/axe/4.14/image-alt',
      target: 'main > img',
      html: '<img src="/a.png">',
    });
    expect(issues[1]).toMatchObject({ rule: 'heading-order', level: 'warning' });
    expect(issues[1]?.html).toHaveLength(200);
  });
});

describe('the report', () => {
  it('goes to .vesper in the project, with a .gitignore, never into dist', () => {
    const root = site({ 'dist/index.html': '' });
    expect(writeReport(root, join(root, 'dist'), report(0, 0))).toBe('.vesper/a11y-report.json');
    expect(JSON.parse(readFileSync(join(root, '.vesper/a11y-report.json'), 'utf8'))).toMatchObject({
      version: 1,
    });
    expect(readFileSync(join(root, '.vesper/.gitignore'), 'utf8')).toContain('*');
    expect(existsSync(join(root, 'dist', '.vesper'))).toBe(false);
  });

  it('isn’t written when the output folder would contain it', () => {
    const root = site({ 'index.html': '' });
    expect(writeReport(root, root, report(0, 0))).toBeNull();
    expect(existsSync(join(root, '.vesper'))).toBe(false);
  });

  it('is summed up in one line for the log', () => {
    expect(
      summaryLine({ report: report(0, 0), written: '.vesper/a11y-report.json', failed: null }),
    ).toBe('Accessibility: checked 3 pages, no issues. Report: .vesper/a11y-report.json');
    expect(
      summaryLine({ report: report(1, 1), written: '.vesper/a11y-report.json', failed: null }),
    ).toBe(
      'Accessibility: checked 3 pages, 2 issues on 1 page (1 error). Report: .vesper/a11y-report.json',
    );
  });
});
