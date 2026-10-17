import { readdirSync } from 'node:fs';
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

/** Pages that are deliberately inaccessible test fixtures, with the reason. */
const AXE_EXCLUDED: Record<string, string> = {};

function builtPages(): string[] {
  const files = readdirSync(dist, { recursive: true, encoding: 'utf8' })
    .map((file) => file.replaceAll('\\', '/'))
    .filter((file) => file.endsWith('.html') && file !== '404.html');
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
    await expect(page.locator('main')).toHaveCount(1);
    await expect(page.locator('h1')).toHaveCount(1);

    const excluded = AXE_EXCLUDED[path];
    if (excluded) {
      test.info().annotations.push({ type: 'axe skipped', description: excluded });
      return;
    }

    const { violations } = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
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
  const { violations } = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(violations).toEqual([]);
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
