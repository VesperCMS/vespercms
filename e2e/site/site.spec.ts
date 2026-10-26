import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

/*
 * vespercms.com (apps/site), built and served from the plain static host:
 * every page in both colour schemes passes axe's WCAG 2.1 A/AA rules, the
 * theme toggle and the hero's art work and fall back, the docs menu works by
 * keyboard at phone width, and llms.txt links only to Markdown copies that
 * exist. Build first: `npm run build -w @vesper/site`.
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
      // At rest: with motion, the hero's words are still fading in when axe looks.
      await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
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

test('the theme toggle switches the palette, remembers it, and forgets it for the system’s', async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  await page.goto('/');
  const root = page.locator('html');
  const toggle = page.getByRole('button', { name: 'Dark theme' });
  const background = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  const light = await background();

  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(root).toHaveAttribute('data-theme', 'dark');
  expect(await background()).not.toBe(light);

  // Applied before first paint on the next page, and axe passes in it.
  await page.goto('/docs/');
  await expect(root).toHaveAttribute('data-theme', 'dark');
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  const { violations } = await new AxeBuilder({ page }).withTags(WCAG21_AA).analyze();
  expect(violations.map(({ id }) => id)).toEqual([]);

  // Light is the system's own here, so choosing it forgets the choice.
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await expect(root).not.toHaveAttribute('data-theme');
  expect(await page.evaluate(() => localStorage.getItem('vesper-theme'))).toBeNull();
  expect(await background()).toBe(light);
});

test('the studio screenshots follow the theme, the toggle’s as well as the system’s', async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await page.goto('/');
  const shot = page.locator('.feature-shot').first();
  await expect(shot.locator('.shot-dark')).toBeVisible();
  await expect(shot.locator('.shot-light')).toBeHidden();
  // Both carry the light picture's alt text.
  const alt = await shot.locator('.shot-light').getAttribute('alt');
  expect(alt).toBeTruthy();
  await expect(shot.locator('.shot-dark')).toHaveAttribute('alt', alt ?? '');

  await page.getByRole('button', { name: 'Dark theme' }).click();
  await expect(shot.locator('.shot-light')).toBeVisible();
  await expect(shot.locator('.shot-dark')).toBeHidden();
});

test('the hero draws the mark with WebGL, or shows the still mark without it', async ({ page }) => {
  await page.goto('/');
  const hero = page.locator('[data-hero]');
  await expect(hero).toHaveAttribute('data-art', /^(live|static)$/);

  await page.addInitScript(() => {
    HTMLCanvasElement.prototype.getContext = () => null;
  });
  await page.reload();
  await expect(hero).toHaveAttribute('data-art', 'static');
  await expect(hero.locator('.hero-fallback')).toBeVisible();
});

test.describe('without scripts', () => {
  test.use({ javaScriptEnabled: false });

  test('the hero shows the still mark, and the theme toggle isn’t offered', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.hero-fallback')).toBeVisible();
    await expect(page.locator('[data-theme-toggle]')).toBeHidden();
    await expect(page.locator('[data-copy]')).toBeHidden();
  });
});

test('Copy puts the install command on the clipboard', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/');
  const command = (await page.locator('.command code').textContent()) ?? '';
  expect(command).toContain('astro add');
  await page.getByRole('button', { name: 'Copy' }).click();
  await expect(page.locator('[data-copy-status]')).toHaveText('Copied to the clipboard');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(command);
});

test('the studio is deployed for the cloud, and kept out of search engines', async ({ page }) => {
  const response = await page.goto('/admin/');
  expect(response?.status()).toBe(200);
  // As built, before the studio sets each screen's: not "Vesper · Vesper".
  expect(await response?.text()).toContain('<title>Studio · Vesper</title>');
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
