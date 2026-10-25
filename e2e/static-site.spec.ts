import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

/*
 * Every page in the built playground, served from a plain static host:
 * - it loads,
 * - it has one <main> and one <h1>,
 * - axe finds no WCAG 2.1 A/AA violations.
 * WCAG 2.2 findings are reported as annotations but don't fail (D11: 2.2 AA
 * "where it's cheap").
 */

const dist = fileURLToPath(new URL('../apps/playground/dist/', import.meta.url));

/**
 * Pages that are deliberately inaccessible test fixtures, with the reason.
 * They must still load; they skip the structure and axe checks.
 */
const AXE_EXCLUDED: Record<string, string> = {
  '/fixtures/accessibility-mistakes/':
    'One deliberate mistake per studio accessibility check (spec §6.18, layer 1).',
};

const WCAG21_AA = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

/** Astro's static redirect pages: a meta refresh and nothing else (tested on their own below). */
const isRedirectPage = (file: string) =>
  readFileSync(`${dist}${file}`, 'utf8').includes('http-equiv="refresh"');

function builtPages(): string[] {
  const files = readdirSync(dist, { recursive: true, encoding: 'utf8' })
    .map((file) => file.replaceAll('\\', '/'))
    .filter((file) => file.endsWith('.html') && file !== '404.html' && !isRedirectPage(file));
  return files.map((file) => `/${file.replace(/(^|\/)index\.html$/, '$1')}`).sort();
}

test.beforeEach(async ({ context, baseURL }) => {
  // Hermetic: a page that needs the network to render correctly would also
  // fail for visitors on a slow connection. Block everything but the site.
  const site = baseURL ?? '';
  await context.route('**/*', (route) =>
    route.request().url().startsWith(site) ? route.continue() : route.abort(),
  );
});

for (const path of builtPages()) {
  test(`page ${path}`, async ({ page }) => {
    const response = await page.goto(path);
    expect(response?.status()).toBe(200);

    const excluded = AXE_EXCLUDED[path];
    if (excluded) {
      test.info().annotations.push({ type: 'axe skipped', description: excluded });
      return;
    }

    await expect(page.locator('main')).toHaveCount(1);
    await expect(page.locator('h1')).toHaveCount(1);
    const { violations } = await new AxeBuilder({ page }).withTags(WCAG21_AA).analyze();
    expect(
      violations.map(({ id, help, nodes }) => ({ id, help, targets: nodes.map((n) => n.target) })),
    ).toEqual([]);

    const wcag22 = await new AxeBuilder({ page }).withTags(['wcag22aa']).analyze();
    for (const violation of wcag22.violations) {
      test
        .info()
        .annotations.push({ type: 'wcag 2.2', description: `${violation.id}: ${violation.help}` });
    }
  });
}

test('unknown URLs get a real 404 with the site 404 page', async ({ page }) => {
  const response = await page.goto('/no/such/page/');
  expect(response?.status()).toBe(404);
  await expect(page.locator('h1')).toHaveText('Page not found');
  const { violations } = await new AxeBuilder({ page }).withTags(WCAG21_AA).analyze();
  expect(violations).toEqual([]);
});

test('the axe gate can fail: it flags the deliberate fixture page', async ({ page }) => {
  // Guards against a misconfigured scan that silently passes everything. Most
  // of the fixture's mistakes are content problems axe can't see (an empty alt
  // is valid HTML; skipped headings are best practice, not WCAG), which is why
  // the studio has its own checks. Contrast is one axe does see.
  await page.goto('/fixtures/accessibility-mistakes/');
  const { violations } = await new AxeBuilder({ page }).withTags(WCAG21_AA).analyze();
  expect(violations.map((v) => v.id)).toContain('color-contrast');
});

test('the build’s accessibility report maps issues to entries, and stays out of dist', () => {
  // Spec §6.18, layer 2: written beside dist/ by the same build this suite serves.
  const report = JSON.parse(
    readFileSync(new URL('../apps/playground/.vesper/a11y-report.json', import.meta.url), 'utf8'),
  ) as {
    pages: { url: string; entry: { collection: string; id: string; file: string } | null }[];
  };
  expect(report.pages.map((p) => [p.url, p.entry])).toEqual([
    [
      '/fixtures/accessibility-mistakes/',
      expect.objectContaining({
        collection: 'fixtures',
        id: 'accessibility-mistakes',
        file: 'src/content/fixtures/accessibility-mistakes.mdoc',
      }),
    ],
  ]);
  const files = readdirSync(dist, { recursive: true, encoding: 'utf8' });
  expect(files.filter((file) => /a11y|\.vesper/i.test(file))).toEqual([]);
});

test('deep links work without rewrite rules', async ({ page }) => {
  const response = await page.goto('/blog/2026/winter-market');
  // The plain host redirects to the trailing-slash form, then serves index.html.
  expect(response?.status()).toBe(200);
  expect(new URL(page.url()).pathname).toBe('/blog/2026/winter-market/');
  await expect(page.locator('h1')).toHaveText('The winter market opens');
});

test('the skip link moves focus to the main content', async ({ page }) => {
  await page.goto('/');
  await page.keyboard.press('Tab');
  const skip = page.getByRole('link', { name: 'Skip to content' });
  await expect(skip).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('main')).toBeFocused();
});

test('the studio shell loads at /admin, deep links included, and says where editing works', async ({
  page,
  request,
}) => {
  // Before the studio runs, the shell's title has every screen's shape: the screen, then the site.
  const shell = await request.get('/admin/');
  expect(await shell.text()).toMatch(/<title>Studio · [^<]+<\/title>/);
  // The Light or Dark choice is applied before the page paints, from the page itself.
  expect(await shell.text()).toContain("localStorage.getItem('vesper:appearance')");
  // A static build has no back end until GitHub mode (Phase 3); local mode needs astro dev.
  await page.goto('/admin/#/c/blog');
  await expect(page.locator('h1')).toHaveText('Editing isn’t available here yet');
  await expect(page).toHaveTitle(/Editing unavailable/);
  // Vesper's mark as the favicon, inline: nothing to fetch, from this host or any other.
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute('href', /^data:image\/svg\+xml,/);
});

test('the build publishes the manifest for the cloud', async ({ request }) => {
  const response = await request.get('/_vesper/manifest.json');
  expect(response.status()).toBe(200);
  const manifest = (await response.json()) as {
    manifestVersion: number;
    collections: { name: string }[];
  };
  expect(manifest.manifestVersion).toBe(1);
  expect(manifest.collections.map((c) => c.name)).toContain('blog');
});

/*
 * Redirects on a plain host (spec §6.15.5, §6.16): Astro's HTML redirect
 * pages, written from vesper.redirects.yaml after the build collapsed its
 * chain. Each old URL must land on a real page in one hop.
 */
type BuiltRedirect = { key: string; from: string; to: string; status: number };
const redirects = JSON.parse(
  readFileSync(`${dist}_vesper/redirects.json`, 'utf8'),
) as BuiltRedirect[];

const META_REFRESH = /<meta http-equiv="refresh" content="\d+;url=([^"]+)">/;
const refreshTarget = (html: string) => META_REFRESH.exec(html)?.[1] ?? null;

test('the build lists the cleaned redirects, with the chain collapsed', () => {
  expect(redirects.map((r) => [r.key, r.to])).toEqual([
    ['/programs/nursing', '/academics/nursing/'],
    ['/academics/nursing-old', '/academics/nursing/'],
    ['/apply-now', '/admissions/apply/'],
  ]);
});

for (const redirect of redirects) {
  test(`${redirect.key} redirects to ${redirect.to} in one hop`, async ({ request, page }) => {
    // The plain host adds the slash for a folder, then serves the redirect page.
    const response = await request.get(`${redirect.key}/`, { maxRedirects: 0 });
    expect(response.status()).toBe(200);
    expect(refreshTarget(await response.text())).toBe(redirect.to);
    const landing = await request.get(redirect.to, { maxRedirects: 0 });
    expect(landing.status()).toBe(200);
    expect(refreshTarget(await landing.text())).toBeNull();

    await page.goto(redirect.key);
    await page.waitForURL((url) => url.pathname === redirect.to);
    await expect(page.locator('h1')).toHaveCount(1);
  });
}

test('breadcrumbs and section lists come from the site helpers, in _order.yaml order', async ({
  page,
}) => {
  await page.goto('/academics/nursing/clinical-placements/partner-hospitals/');
  const crumbs = page.getByRole('navigation', { name: 'Breadcrumb' }).getByRole('listitem');
  await expect(crumbs).toHaveText([
    'Vesper playground',
    'Academics',
    'Nursing',
    'Clinical placements',
    'Partner hospitals',
  ]);
  await expect(
    page.getByRole('navigation', { name: 'Breadcrumb' }).locator('[aria-current="page"]'),
  ).toHaveText('Partner hospitals');
  await page.goto('/academics/');
  await expect(page.getByRole('region', { name: 'In this section' }).getByRole('link')).toHaveText([
    'Nursing',
    'Business',
    'General studies',
  ]);
});
