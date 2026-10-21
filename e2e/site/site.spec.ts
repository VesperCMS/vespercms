import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

/*
 * vespercms.com (apps/site), built and served from the plain static host:
 * every page in both colour schemes passes axe's WCAG 2.1 A/AA rules, the
 * docs menu works by keyboard at phone width, and llms.txt links only to
 * Markdown copies that exist. Build first: `npm run build -w @vesper/site`.
 */

const dist = fileURLToPath(new URL('../../apps/site/dist/', import.meta.url));
const WCAG21_AA = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

/** The site's own pages. /admin is the studio, which the studio, github and cloud projects test. */
function builtPages(): string[] {
  return readdirSync(dist, { recursive: true, encoding: 'utf8' })
    .map((file) => file.replaceAll('\\', '/'))
    .filter((file) => file.endsWith('.html') && file !== '404.html')
    .map((file) => `/${file.replace(/(^|\/)index\.html$/, '$1')}`)
    .filter((path) => !path.startsWith('/admin/'))
    .sort();
}

test.beforeEach(async ({ context, baseURL }) => {
  // Hermetic, like the playground's: the site must render from its own files.
  const site = baseURL ?? '';
  await context.route('**/*', (route) =>
    route.request().url().startsWith(site) ? route.continue() : route.abort(),
  );
});

for (const path of builtPages()) {
  for (const colorScheme of ['light', 'dark'] as const) {
    test(`page ${path} (${colorScheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme });
      const response = await page.goto(path);
      expect(response?.status()).toBe(200);
      await expect(page.locator('main')).toHaveCount(1);
      await expect(page.locator('h1')).toHaveCount(1);
      const { violations } = await new AxeBuilder({ page }).withTags(WCAG21_AA).analyze();
      expect(
        violations.map(({ id, help, nodes }) => ({
          id,
          help,
          targets: nodes.map((n) => n.target),
        })),
      ).toEqual([]);
    });
  }
}

test('the studio is deployed for the cloud, and kept out of search engines', async ({ page }) => {
  const response = await page.goto('/admin/');
  expect(response?.status()).toBe(200);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow');
});

test('unknown URLs get a real 404 with the site’s page', async ({ page }) => {
  const response = await page.goto('/no/such/page/');
  expect(response?.status()).toBe(404);
  await expect(page.locator('h1')).toHaveText('Page not found');
});

test('the docs menu follows the tree and marks the current page', async ({ page }) => {
  await page.goto('/docs/getting-started/install/');
  const menu = page.getByRole('navigation', { name: 'Docs' });
  await expect(menu.getByRole('link', { name: 'Install' })).toHaveAttribute('aria-current', 'page');
  // _order.yaml: Getting started comes before Content, and Install before Your first edit.
  const links = await menu.getByRole('link').allTextContents();
  expect(links.indexOf('Getting started')).toBeLessThan(links.indexOf('Content'));
  expect(links.indexOf('Install')).toBeLessThan(links.indexOf('Your first edit'));
});

test('at phone width the docs menu starts closed and opens by keyboard', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto('/docs/getting-started/install/');
  const menu = page.getByRole('navigation', { name: 'Docs' });
  await expect(menu).toBeHidden();
  const toggle = page.locator('summary', { hasText: 'Docs menu' });
  await toggle.focus();
  await page.keyboard.press('Enter');
  await expect(menu).toBeVisible();
});

test('llms.txt lists every docs page, and each Markdown copy exists', async ({ page, request }) => {
  const response = await request.get('/llms.txt');
  expect(response.status()).toBe(200);
  const text = await response.text();
  expect(text.startsWith('# Vesper\n\n> ')).toBe(true);
  // The links are absolute, to vespercms.com; this host serves the same paths.
  const links = [...text.matchAll(/\]\((https?:\/\/[^)]+\.md)\)/g)].map(
    ([, href]) => new URL(href ?? '').pathname,
  );
  const docs = builtPages().filter((path) => path.startsWith('/docs/'));
  expect(links).toHaveLength(docs.length);
  for (const link of links) {
    const markdown = await request.get(link);
    expect(markdown.status(), link).toBe(200);
    expect((await markdown.text()).startsWith('# '), link).toBe(true);
  }
  // The page links to its own copy.
  await page.goto('/docs/agents/');
  await expect(page.getByRole('link', { name: 'This page as Markdown' })).toHaveAttribute(
    'href',
    '/docs/agents.md',
  );
});

test('search finds a docs page', async ({ page }) => {
  await page.goto('/search/?q=redirects');
  await expect(
    page.getByRole('main').getByRole('link', { name: 'Pages, URLs and redirects' }),
  ).toBeVisible();
});

test('the build’s accessibility report stays out of dist', () => {
  const report = JSON.parse(
    readFileSync(new URL('../../apps/site/.vesper/a11y-report.json', import.meta.url), 'utf8'),
  ) as { pages: unknown[] };
  expect(report.pages).toEqual([]);
  const files = readdirSync(dist, { recursive: true, encoding: 'utf8' });
  expect(files.filter((file) => /a11y|\.vesper/i.test(file))).toEqual([]);
});
