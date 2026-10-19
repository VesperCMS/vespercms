import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';

/*
 * Site search on the built playground (spec §6.19, Phase 2.9), served by the
 * plain static server with its default MIME types, so this is search as a
 * host with no settings serves it:
 * - a query in each collection finds its page, and Section and Tags narrow;
 * - hidden, unpublished and unsearched entries never appear;
 * - keys alone open, search, move through results and close;
 * - the count is announced from a live region inside the dialog;
 * - axe passes closed, open, filtered, in dark mode and on /search;
 * - nothing scrolls sideways at 200% zoom or on a phone;
 * - without JavaScript, the button is a link and /search explains.
 * The playground's own scheduled events go live as the calendar passes, so
 * scheduling is checked in the build's integration test with a 2099 event.
 */

const WCAG21_AA = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

test.beforeEach(async ({ context, baseURL }) => {
  const site = baseURL ?? '';
  await context.route('**/*', (route) =>
    route.request().url().startsWith(site) ? route.continue() : route.abort(),
  );
});

async function axe(page: Page): Promise<void> {
  const { violations } = await new AxeBuilder({ page }).withTags(WCAG21_AA).analyze();
  expect(
    violations.map(({ id, help, nodes }) => ({ id, help, targets: nodes.map((n) => n.target) })),
  ).toEqual([]);
}

async function openSearch(page: Page, path = '/'): Promise<Locator> {
  await page.goto(path);
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Search this site' });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function search(dialog: Locator, query: string): Promise<void> {
  await dialog.getByRole('searchbox', { name: 'Search this site' }).fill(query);
  await expect(dialog.getByRole('status')).toHaveText(
    new RegExp(`^(\\d+ results?|No results) for “${query}”$`),
  );
}

const results = (dialog: Locator) =>
  dialog.getByRole('list', { name: 'Search results' }).getByRole('link');

test('a query in each collection finds its page', async ({ page }) => {
  const dialog = await openSearch(page);
  for (const [query, title, href] of [
    ['harbor', 'Harbor at dawn', '/blog/harbor-at-dawn/'],
    ['placements', 'Clinical placements', '/academics/nursing/clinical-placements/'],
    ['callouts', 'Writing callouts', '/docs/guides/writing-callouts/'],
    ['commencement', 'Spring commencement', '/events/spring-commencement/'],
  ] as const) {
    await search(dialog, query);
    await expect(results(dialog).filter({ hasText: title }).first()).toHaveAttribute('href', href);
  }
});

test('Section and Tags filters narrow the results, and the count is announced', async ({
  page,
}) => {
  const dialog = await openSearch(page);
  await search(dialog, 'nursing');
  const section = dialog.getByRole('group', { name: 'Section' });
  await section.getByRole('checkbox', { name: /^Events \(\d+\)$/ }).check();
  await expect(dialog.getByRole('status')).toHaveText('1 result for “nursing”');
  await expect(results(dialog)).toHaveCount(1);
  await expect(results(dialog).first()).toHaveAttribute('href', /^\/events\//);
  // Events sort by when they start, once that section is chosen.
  await expect(dialog.getByRole('combobox', { name: 'Sort' })).toBeVisible();

  await search(dialog, 'harbor');
  await section.getByRole('checkbox', { name: /^Events/ }).uncheck();
  await dialog
    .getByRole('group', { name: 'Tags' })
    .getByRole('checkbox', { name: 'photography (1)' })
    .check();
  await expect(dialog.getByRole('status')).toHaveText('1 result for “harbor”');
  await expect(results(dialog)).toHaveText(['Harbor at dawn']);
  await axe(page);
});

test('hidden, unpublished and unsearched entries never appear', async ({ page }) => {
  const dialog = await openSearch(page);
  for (const [query, title] of [
    ['touch', 'Thanks for getting in touch'],
    ['orientation', 'Summer orientation'],
    ['mistakes', 'Accessibility mistakes'],
  ] as const) {
    await search(dialog, query);
    await expect(results(dialog).filter({ hasText: title })).toHaveCount(0);
  }
});

test('keys alone: open, type, ArrowDown, Tab, Escape, and focus back on the button', async ({
  page,
}) => {
  await page.goto('/');
  const button = page.getByRole('button', { name: 'Search', exact: true });
  await expect(button).toHaveAttribute('aria-haspopup', 'dialog');
  await expect(button).toHaveAccessibleDescription(/^Keyboard shortcut: (Ctrl\+K|⌘K)$/);
  await page.keyboard.press('ControlOrMeta+k');
  const dialog = page.getByRole('dialog', { name: 'Search this site' });
  const field = dialog.getByRole('searchbox', { name: 'Search this site' });
  await expect(field).toBeFocused();
  await page.keyboard.type('nursing');
  await expect(dialog.getByRole('status')).toHaveText(/^\d+ results for “nursing”$/);
  await page.keyboard.press('ArrowDown');
  await expect(results(dialog).first()).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(results(dialog).nth(1)).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(results(dialog).nth(2)).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(button).toBeFocused();
  // Reopening keeps the query.
  await page.keyboard.press('Enter');
  await expect(field).toHaveValue('nursing');
  await expect(field).toBeFocused();
  // Escape inside the field closes the dialog without clearing the field first.
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(page.locator('#vesper-search-field')).toHaveValue('nursing');
});

test('the count is spoken from a live region inside the dialog', async ({ page }) => {
  const dialog = await openSearch(page);
  await search(dialog, 'nursing');
  const status = dialog.locator('[role="status"]');
  await expect(status).toHaveCount(1);
  // showModal() makes everything outside the dialog inert, live regions included.
  expect(await status.evaluate((element) => element.closest('dialog') !== null)).toBe(true);
});

test('Show more results adds ten, with focus on the first new one', async ({ page }) => {
  const dialog = await openSearch(page);
  await search(dialog, 'the');
  await expect(results(dialog)).toHaveCount(10);
  await dialog.getByRole('button', { name: 'Show more results' }).click();
  await expect(results(dialog).nth(10)).toBeFocused();
  expect(await results(dialog).count()).toBeGreaterThan(10);
});

test('axe passes closed, open with results, and in dark mode', async ({ page }) => {
  await page.goto('/');
  await axe(page);
  const dialog = await openSearch(page);
  await search(dialog, 'harbor');
  await axe(page);
  await page.emulateMedia({ colorScheme: 'dark' });
  await axe(page);
});

test('matches stay visible in a forced-colours theme', async ({ page }) => {
  await page.emulateMedia({ forcedColors: 'active', colorScheme: 'dark' });
  const dialog = await openSearch(page);
  await search(dialog, 'harbor');
  const mark = dialog.locator('mark').first();
  const colours = await mark.evaluate((element) => {
    const style = getComputedStyle(element);
    return { color: style.color, background: style.backgroundColor };
  });
  expect(colours.background).not.toBe('rgba(0, 0, 0, 0)');
  expect(colours.background).not.toBe(colours.color);
});

for (const [width, height] of [
  [640, 400],
  [320, 640],
] as const) {
  test(`nothing scrolls sideways at ${String(width)}×${String(height)}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    const dialog = await openSearch(page);
    await search(dialog, 'nursing');
    await expect(dialog.getByRole('button', { name: 'Close' })).toBeVisible();
    for (const element of [page.locator('html'), dialog]) {
      const { scroll, client } = await element.evaluate((el) => ({
        scroll: el.scrollWidth,
        client: el.clientWidth,
      }));
      expect(scroll).toBeLessThanOrEqual(client);
    }
  });
}

test('/search runs the query in its address, and passes axe', async ({ page }) => {
  await page.goto('/search/?q=nursing');
  await expect(page.getByRole('heading', { level: 1, name: 'Search' })).toBeVisible();
  const box = page.locator('[data-vesper-search="inline"]');
  await expect(box.getByRole('status')).toHaveText(/^\d+ results for “nursing”$/);
  await expect(box.getByRole('searchbox', { name: 'Search this site' })).toHaveValue('nursing');
  await axe(page);
});

test.describe('without JavaScript', () => {
  test.use({ javaScriptEnabled: false });

  test('the button is a link to /search, which says search needs JavaScript', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: 'Search', exact: true }).click();
    await expect(page).toHaveURL(/\/search\/$/);
    // Playwright's text and role locators skip <noscript>, which Chromium shows here.
    expect(await page.locator('main').innerText()).toContain(
      'Search needs JavaScript. Go to the home page',
    );
    await expect(page.locator('noscript a')).toHaveAttribute('href', '/');
    // axe runs as a script, so it can't run here; /search passes it above.
  });
});
