import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { keys } from './keys.ts';

/*
 * Pages, moves and redirects in the studio (spec §6.15), in Chromium, on
 * astro dev over the throwaway copy of the playground. The tree tests use
 * the keyboard only, and every save is checked in the files on disk.
 */

const site = fileURLToPath(new URL('../.studio-site/', import.meta.url));
const read = (path: string) =>
  existsSync(`${site}${path}`) ? readFileSync(`${site}${path}`, 'utf8') : null;
const WCAG21_AA = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const P = 'src/content/pages/';

/** Files the running test changes, as they were before it (null: not there yet). */
const touched = new Map<string, Buffer | null>();
const folders = new Set<string>();
function touches(...paths: string[]) {
  for (const path of paths) {
    if (!touched.has(path)) {
      touched.set(path, existsSync(`${site}${path}`) ? readFileSync(`${site}${path}`) : null);
    }
  }
}

test.beforeEach(async ({ context, baseURL }) => {
  const origin = baseURL ?? '';
  await context.route('**/*', (route) =>
    route.request().url().startsWith(origin) ||
    route.request().url().startsWith('http://127.0.0.1:4400')
      ? route.continue()
      : route.abort(),
  );
});

// Every test leaves the site as it found it, so a retry starts from the same files.
test.afterEach(() => {
  for (const [path, bytes] of touched) {
    if (bytes === null) rmSync(`${site}${path}`, { force: true });
    else writeFileSync(`${site}${path}`, bytes);
  }
  for (const folder of folders) rmSync(`${site}${folder}`, { recursive: true, force: true });
  touched.clear();
  folders.clear();
});

async function expectAccessible(page: Page) {
  const { violations } = await new AxeBuilder({ page })
    .withTags(WCAG21_AA)
    .exclude('astro-dev-toolbar')
    // React Aria's visually hidden announcer: after a combobox's dialog closes, its last
    // "selected" message still points at the gone option's label for a few seconds.
    .exclude('[data-live-announcer]')
    .analyze();
  expect(violations.map(({ id, nodes }) => ({ id, targets: nodes.map((n) => n.target) }))).toEqual(
    [],
  );
}

/** Presses Tab until `target` has focus: the keyboard's own way there. */
async function tabTo(page: Page, target: Locator, max = 20) {
  for (let i = 0; i < max; i++) {
    if (await target.evaluate((element) => element === document.activeElement)) return;
    await page.keyboard.press('Tab');
  }
  await expect(target).toBeFocused();
}

async function openOutline(page: Page) {
  await page.goto('/admin/#/c/pages');
  const grid = page.getByRole('treegrid', { name: 'Pages' });
  await expect(grid.getByRole('row', { name: 'Academics' })).toBeVisible();
  return grid;
}

/** Focuses the outline from the top of the screen, by keyboard. */
async function enterOutline(page: Page, grid: Locator) {
  await tabTo(page, grid.getByRole('row').first());
}

const announcement = (page: Page) => page.locator('[role="status"][aria-live="polite"]');

test('searching the outline shows the pages that match under the pages above them', async ({
  page,
}) => {
  const grid = await openOutline(page);
  const search = page.getByRole('searchbox', { name: 'Search' });
  await search.fill('nurs');
  await expect(grid.getByRole('row')).toHaveCount(2);
  await expect(grid.getByRole('row', { name: 'Academics' })).toHaveAttribute(
    'aria-expanded',
    'true',
  );
  await expect(grid.getByRole('row', { name: 'Nursing' })).toBeVisible();
  await expectAccessible(page);
  await search.fill('');
  await expect(grid.getByRole('row', { name: 'About the college' })).toBeVisible();
});

test('the outline, its menu and its dialogs pass axe; Redirects too', async ({ page }) => {
  const grid = await openOutline(page);
  await expectAccessible(page);
  await grid.getByRole('button', { name: 'More actions for About the college' }).click();
  await expect(page.getByRole('menu')).toBeVisible();
  await expectAccessible(page);
  await page.getByRole('menuitem', { name: 'Move to…' }).click();
  await expect(page.getByRole('dialog', { name: 'Move “About the college”' })).toBeVisible();
  await expectAccessible(page);
  await page.keyboard.press('Escape');

  await page.goto('/admin/#/redirects');
  await expect(page.getByRole('grid', { name: 'Redirects' })).toBeVisible();
  await expectAccessible(page);
  await page.getByRole('button', { name: 'Add redirect' }).click();
  await expect(page.getByRole('dialog', { name: 'Add a redirect' })).toBeVisible();
  await expectAccessible(page);
});

test('by keyboard: expand, collapse, and reorder with Alt+arrows, announced and saved', async ({
  page,
}) => {
  touches(`${P}academics/_order.yaml`);
  const grid = await openOutline(page);
  await enterOutline(page, grid);
  await page.keyboard.press('ArrowDown'); // About the college
  await page.keyboard.press('ArrowDown'); // Academics
  const academics = grid.getByRole('row', { name: 'Academics' });
  await expect(academics).toBeFocused();
  await expect(academics).toHaveAttribute('aria-expanded', 'false');
  await page.keyboard.press('ArrowRight');
  await expect(academics).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('ArrowDown');
  const nursing = grid.getByRole('row', { name: 'Nursing' });
  await expect(nursing).toBeFocused();
  await expect(nursing).toHaveAttribute('aria-level', '2');

  await page.keyboard.press('Alt+ArrowDown');
  await expect(announcement(page)).toHaveText('Nursing moved down, position 2 of 3.');
  expect(read(`${P}academics/_order.yaml`)).toBe('- business\n- nursing\n- general-studies\n');
  await expect(nursing).toBeFocused();

  await page.keyboard.press('Alt+ArrowUp');
  await expect(announcement(page)).toHaveText('Nursing moved up, position 1 of 3.');
  expect(read(`${P}academics/_order.yaml`)).toBe('- nursing\n- business\n- general-studies\n');

  // Left goes to the parent, and Left again collapses it.
  await page.keyboard.press('ArrowLeft');
  await expect(academics).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(academics).toHaveAttribute('aria-expanded', 'false');
});

test('by keyboard: move Nursing and its pages to the top level, in one go', async ({ page }) => {
  const moved = [
    'index.md',
    '_order.yaml',
    'rn-to-bsn.md',
    'clinical-placements/index.md',
    'clinical-placements/partner-hospitals.md',
  ];
  touches(
    ...moved.map((file) => `${P}academics/nursing/${file}`),
    ...moved.map((file) => `${P}nursing/${file}`),
    `${P}_order.yaml`,
    `${P}academics/_order.yaml`,
    `${P}academics/index.md`,
    `${P}admissions/apply.md`,
    `${P}campus-life.mdx`,
    'src/content/docs/_support-hours.mdoc',
    'src/content/events/nursing-info-session.md',
    'vesper.redirects.yaml',
  );
  folders.add(`${P}nursing`);
  const grid = await openOutline(page);
  await enterOutline(page, grid);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowRight'); // expand Academics
  await page.keyboard.press('ArrowDown'); // Nursing
  await expect(grid.getByRole('row', { name: 'Nursing' })).toBeFocused();
  await page.keyboard.press('Shift+F10');
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  await page.keyboard.press('ArrowDown'); // Add child page
  await page.keyboard.press('ArrowDown'); // Duplicate
  await page.keyboard.press('ArrowDown'); // Move to…
  await expect(menu.getByRole('menuitem', { name: 'Move to…' })).toBeFocused();
  await page.keyboard.press('Enter');

  const dialog = page.getByRole('dialog', { name: 'Move “Nursing”' });
  await expect(dialog).toBeVisible();
  const parent = dialog.getByRole('combobox', { name: 'Put it under' });
  await tabTo(page, parent);
  await page.keyboard.press(keys.selectAll);
  await page.keyboard.type('Top');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(parent).toHaveValue('Top level');
  await tabTo(page, dialog.getByRole('textbox', { name: 'Address' }));
  await page.keyboard.press('Enter'); // submits: Review move

  const confirm = page.getByRole('alertdialog', { name: 'Move “Nursing”?' });
  await expect(confirm).toContainText(
    'This moves “Nursing” and its 3 pages to the top level. Its address becomes /nursing/. 8 links on other pages will be updated. Visitors to the old addresses will be sent to the new ones.',
  );
  await expectAccessible(page);
  await tabTo(page, confirm.getByRole('button', { name: 'Move' }));
  await page.keyboard.press('Enter');
  await expect(announcement(page)).toHaveText('Nursing moved to the top level, position 5 of 6.');

  // One set of renames on disk: the folder, both order files, redirects and every link.
  expect(read(`${P}academics/nursing/index.md`)).toBeNull();
  expect(read(`${P}nursing/clinical-placements/partner-hospitals.md`)).toContain(
    'Partner hospitals',
  );
  expect(read(`${P}nursing/_order.yaml`)).toBe('- clinical-placements\n- rn-to-bsn\n');
  expect(read(`${P}academics/_order.yaml`)).toBe('- business\n- general-studies\n');
  expect(read(`${P}_order.yaml`)).toMatch(/- campus-life\n- nursing\n$/);
  const redirects = read('vesper.redirects.yaml') ?? '';
  expect(redirects).toContain('- { from: /programs/nursing, to: /nursing,');
  expect(redirects).toContain('- { from: /academics/nursing-old, to: /nursing,');
  for (const path of [
    '',
    '/clinical-placements',
    '/clinical-placements/partner-hospitals',
    '/rn-to-bsn',
  ]) {
    expect(redirects).toContain(
      `- { from: /academics/nursing${path}, to: /nursing${path}, status: 301, reason: move, at: `,
    );
  }
  expect(read(`${P}academics/index.md`)).toContain('[Nursing](/nursing/)');
  expect(read(`${P}admissions/apply.md`)).toContain('(/nursing/clinical-placements/)');
  expect(read('src/content/events/nursing-info-session.md')).toContain(
    'unpublishRedirect: /nursing/\n',
  );
  expect(read('src/content/docs/_support-hours.mdoc')).toContain('[nursing office](/nursing/)');

  await expect(grid.getByRole('row', { name: 'Nursing' })).toBeVisible();
});

test('a page can’t take an address src/pages already owns, said plainly', async ({ page }) => {
  const grid = await openOutline(page);
  await grid.getByRole('button', { name: 'More actions for About the college' }).click();
  await page.getByRole('menuitem', { name: 'Move to…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Move “About the college”' });
  const address = dialog.getByRole('textbox', { name: 'Address' });
  await address.fill('contact');
  await address.press('Enter');
  await expect(dialog.getByRole('alert')).toHaveText(
    '/contact/ is already a page on this site that isn’t edited here (src/pages/contact.astro). Choose a different address.',
  );
  expect(read(`${P}about.md`)).not.toBeNull();
  expect(read(`${P}contact.md`)).toBeNull();
});

test('by keyboard: add a child page, and create a missing section page', async ({ page }) => {
  touches(`${P}academics/business/small-business.md`, `${P}admissions/index.md`);
  const grid = await openOutline(page);
  await enterOutline(page, grid);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown'); // Business
  await expect(grid.getByRole('row', { name: 'Business' })).toBeFocused();
  await page.keyboard.press('Shift+F10');
  await expect(page.getByRole('menuitem', { name: 'Add child page' })).toBeVisible();
  await page.keyboard.press('ArrowDown'); // Open → Add child page
  await page.keyboard.press('Enter');
  await expect(
    page.getByText('This page will go under “Business”.', { exact: false }),
  ).toBeVisible();
  const title = page.getByRole('textbox', { name: 'Title' });
  await title.focus();
  await page.keyboard.type('Small business');
  await page.keyboard.press(keys.save);
  await expect(page).toHaveURL(/#\/c\/pages\/e\/academics%2Fbusiness%2Fsmall-business$/);
  expect(read(`${P}academics/business/small-business.md`)).toContain('title: Small business');

  await page.goto('/admin/#/c/pages');
  const admissions = grid.getByRole('row', { name: 'Admissions' });
  await expect(admissions).toContainText('No section page');
  await admissions.focus();
  await page.keyboard.press('Shift+F10');
  await page.getByRole('menuitem', { name: 'Create section page' }).press('Enter');
  await expect(page).toHaveURL(/#\/c\/pages\/e\/admissions$/);
  expect(read(`${P}admissions/index.md`)).toBe('---\ntitle: Admissions\n---\n\n');
});

test('Redirects: add one by keyboard and import a WordPress CSV', async ({ page }) => {
  touches('vesper.redirects.yaml');
  await page.goto('/admin/#/redirects');
  await expect(page.getByRole('row', { name: /\/apply-now/ })).toContainText('Temporary');
  await page.getByRole('button', { name: 'Add redirect' }).focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Add a redirect' });
  await tabTo(page, dialog.getByRole('textbox', { name: 'Old address' }));
  await page.keyboard.type('/visit');
  await page.keyboard.press('Tab');
  await page.keyboard.type('campus');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(dialog.getByRole('combobox', { name: 'Goes to' })).toHaveValue('/campus-life/');
  await tabTo(page, dialog.getByRole('button', { name: 'Add redirect' }));
  await page.keyboard.press('Enter');
  await expect(page.getByText('Added a redirect from /visit.')).toBeVisible();
  expect(read('vesper.redirects.yaml')).toContain(
    '- { from: /visit, to: /campus-life/, status: 301, reason: manual, at: ',
  );

  await page.locator('input[type="file"]').setInputFiles({
    name: 'redirection.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(
      'source,target,regex,code,type,hits,title,status\nhttps://old.example.edu/about-us/,/about,0,301,url,3,,enabled\n/news/(.*),/blog/$1,1,301,url,0,,enabled\n',
    ),
  });
  const preview = page.getByRole('dialog', { name: 'Import redirection.csv' });
  await expect(preview).toContainText('1 new redirect.');
  await expect(preview).toContainText('Row 3: Pattern redirects can’t be imported.');
  await expectAccessible(page);
  await preview.getByRole('button', { name: 'Import 1 redirect' }).press('Enter');
  await expect(page.getByText('Imported 1 redirect.')).toBeVisible();
  expect(read('vesper.redirects.yaml')).toContain(
    '- { from: /about-us, to: /about, status: 301, reason: import, at: ',
  );
});

test('the site helpers return the same in astro dev as in the static build', async ({
  request,
}) => {
  const built = await request.get('http://127.0.0.1:4400/site-tree.json');
  expect(built.status()).toBe(200);
  const dev = await request.get('/site-tree.json');
  expect(dev.status()).toBe(200);
  type SiteTree = { tree: { title: string }[]; urls: Record<string, string> };
  const tree = (await built.json()) as SiteTree;
  expect(tree.tree.map((n) => n.title)).toEqual([
    'Vesper playground',
    'About the college',
    'Academics',
    'Admissions',
    'Campus life',
    'Thanks for getting in touch',
  ]);
  // Events are scheduled: the build, as of 26 October 2026, leaves out the
  // ones that aren't live, and dev keeps them all to be edited.
  const split = (urls: Record<string, string>) => [
    Object.fromEntries(Object.entries(urls).filter(([key]) => !key.startsWith('events/'))),
    Object.fromEntries(Object.entries(urls).filter(([key]) => key.startsWith('events/'))),
  ];
  const fromDev = (await dev.json()) as SiteTree;
  const [devUrls, devEvents] = split(fromDev.urls);
  const [builtUrls, builtEvents] = split(tree.urls);
  expect({ ...fromDev, urls: devUrls }).toEqual({ ...tree, urls: builtUrls });
  expect(Object.keys(builtEvents ?? {}).sort()).toEqual([
    'events/nursing-info-session',
    'events/spring-commencement',
  ]);
  expect(devEvents).toMatchObject(builtEvents ?? {});
  expect(Object.keys(devEvents ?? {})).toHaveLength(6);
});

test('drag and drop is offered on top, with React Aria’s keyboard mode', async ({ page }) => {
  touches(`${P}_order.yaml`);
  const before = read(`${P}_order.yaml`) ?? '';
  const grid = await openOutline(page);
  await enterOutline(page, grid);
  await page.keyboard.press('ArrowDown'); // About the college
  await page.keyboard.press('ArrowRight'); // its drag handle
  await expect(grid.getByRole('button', { name: 'Drag About the college' })).toBeFocused();
  await page.keyboard.press('Enter'); // start dragging
  await page.keyboard.press('ArrowDown'); // Drop on Academics
  await page.keyboard.press('ArrowDown'); // Insert between Academics and Admissions
  await expect(page.locator(':focus')).toHaveAttribute(
    'aria-label',
    'Insert between Academics and Admissions',
  );
  await page.keyboard.press('Enter');
  await expect(announcement(page)).toHaveText('About the college moved, position 2 of 5.');
  // A reorder lists every sibling, so the unlisted thank-you page joins the file.
  expect(read(`${P}_order.yaml`)).toBe(
    `${before.replace('- about\n- academics\n', '- academics\n- about\n')}- contact-thanks\n`,
  );

  // Dropping onto a page moves under it, through the same confirmation as Move to….
  await grid.getByRole('row', { name: 'Campus life' }).focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  for (let i = 0; i < 8; i++) {
    const label = await page.locator(':focus').getAttribute('aria-label');
    if (label === 'Drop on Academics') break;
    await page.keyboard.press('ArrowUp');
  }
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Move “Campus life”' });
  await expect(dialog.getByRole('combobox', { name: 'Put it under' })).toHaveValue('Academics');
  await page.keyboard.press('Escape');
});
