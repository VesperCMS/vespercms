import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';

/*
 * A flat collection in a set order (vesper.config.ts's `orderBy`), in
 * Chromium on astro dev over the throwaway copy of the playground. The
 * playground's docs are ordered by `order`, and two share 3. Every move is
 * checked in the files on disk.
 */

const site = fileURLToPath(new URL('../.studio-site/', import.meta.url));
const D = 'src/content/docs/';
const FILES = [
  'getting-started.mdoc',
  'guides/writing-callouts.mdoc',
  'guides/conditional-content.mdoc',
  'guides/opening-hours.mdoc',
];
const read = (path: string) => readFileSync(`${site}${D}${path}`, 'utf8');
const orderIn = (path: string) => /^order: (.*)$/m.exec(read(path))?.[1];
const WCAG21_AA = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

let before = new Map<string, string>();
test.beforeEach(async ({ context, baseURL }) => {
  before = new Map(FILES.map((path) => [path, read(path)]));
  const origin = baseURL ?? '';
  await context.route('**/*', (route) =>
    route.request().url().startsWith(origin) ? route.continue() : route.abort(),
  );
});

// Every test leaves the site as it found it, so a retry starts from the same files.
test.afterEach(() => {
  for (const [path, text] of before) writeFileSync(`${site}${D}${path}`, text);
});

async function openDocs(page: Page): Promise<Locator> {
  await page.goto('/admin/#/c/docs');
  const grid = page.getByRole('treegrid', { name: 'Docs' });
  await expect(grid.getByRole('row').first()).toContainText('Getting started');
  return grid;
}

/** Each row's title: the first line of what it shows. */
const titles = async (grid: Locator) =>
  (await grid.getByRole('row').allInnerTexts()).map((text) => text.split('\n')[0]?.trim());

test('the list is in order, and Alt+arrows move a row, announced and written', async ({ page }) => {
  const grid = await openDocs(page);
  await expect(page.getByRole('button', { name: 'Sort: Order' })).toBeVisible();
  expect(await titles(grid)).toEqual([
    'Getting started',
    'Writing callouts',
    'Conditional content',
    'Opening hours',
  ]);

  const hours = grid.getByRole('row', { name: /^Opening hours/ });
  await hours.focus();
  await page.keyboard.press('Alt+ArrowUp');
  const status = page.getByRole('main', { name: 'Docs' }).getByRole('status');
  await expect(status).toHaveText('Opening hours moved up, position 3 of 4.');
  // 2 and 3 leave no room, so the one below moves up one too: two files, nothing else.
  expect(orderIn('guides/opening-hours.mdoc')).toBe('3');
  expect(orderIn('guides/conditional-content.mdoc')).toBe('4');
  expect(read('guides/conditional-content.mdoc')).toBe(
    (before.get('guides/conditional-content.mdoc') ?? '').replace('order: 3', 'order: 4'),
  );
  expect(read('getting-started.mdoc')).toBe(before.get('getting-started.mdoc'));
  await expect
    .poll(() => titles(grid))
    .toEqual(['Getting started', 'Writing callouts', 'Opening hours', 'Conditional content']);
  await expect(hours).toBeFocused();

  await page.keyboard.press('Alt+ArrowUp');
  await expect(status).toHaveText('Opening hours moved up, position 2 of 4.');
  // Halfway between 1 and 2 has no whole number either.
  await expect.poll(() => titles(grid)).toContain('Opening hours');
  expect((await titles(grid))[1]).toBe('Opening hours');
});

test('drag and drop by React Aria’s keyboard mode, and the row’s menu, pass axe', async ({
  page,
}) => {
  const grid = await openDocs(page);
  await grid.getByRole('row', { name: /^Getting started/ }).focus();
  await page.keyboard.press('ArrowRight'); // its drag handle
  await expect(grid.getByRole('button', { name: 'Drag Getting started' })).toBeFocused();
  await page.keyboard.press('Enter');
  for (let i = 0; i < 8; i++) {
    const label = await page.locator(':focus').getAttribute('aria-label');
    if (label?.startsWith('Insert after Opening hours')) break;
    await page.keyboard.press('ArrowDown');
  }
  await expect(page.locator(':focus')).toHaveAttribute('aria-label', /^Insert after Opening hours/);
  await page.keyboard.press('Enter');
  const status = page.getByRole('main', { name: 'Docs' }).getByRole('status');
  await expect(status).toHaveText('Getting started moved, position 4 of 4.');
  // Past the last: its number plus 10, and no other file.
  expect(orderIn('getting-started.mdoc')).toBe('13');
  expect(read('guides/writing-callouts.mdoc')).toBe(before.get('guides/writing-callouts.mdoc'));

  const menu = grid.getByRole('button', { name: 'More actions for Writing callouts' });
  await menu.click();
  await expect(page.getByRole('menuitem', { name: 'Move up' })).toBeDisabled();
  const { violations } = await new AxeBuilder({ page })
    .withTags(WCAG21_AA)
    .exclude('astro-dev-toolbar')
    .exclude('[data-live-announcer]')
    .analyze();
  expect(violations.map(({ id, nodes }) => ({ id, targets: nodes.map((n) => n.target) }))).toEqual(
    [],
  );
  await page.getByRole('menuitem', { name: 'Move down' }).click();
  await expect(status).toHaveText('Writing callouts moved down, position 2 of 4.');
});
