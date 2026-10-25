import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { jpegFacts } from '../../packages/admin/src/media/formats.ts';
import { keys } from './keys.ts';

/*
 * The studio in local mode, end to end: astro dev over a throwaway copy of
 * the playground (scripts/studio-site.mjs). The tests read the copy's files
 * to prove what a save really wrote.
 */

const site = fileURLToPath(new URL('../.studio-site/', import.meta.url));
const fixtures = fileURLToPath(new URL('../../apps/playground/fixtures/uploads/', import.meta.url));
const read = (path: string) => readFileSync(`${site}${path}`, 'utf8');
const WCAG21_AA = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

/** Files the running test saves or uploads, as they were before it (null: not there yet). */
const touched = new Map<string, Buffer | null>();
function touches(...paths: string[]) {
  for (const path of paths) {
    if (!touched.has(path)) {
      touched.set(path, existsSync(`${site}${path}`) ? readFileSync(`${site}${path}`) : null);
    }
  }
}

async function expectAccessible(page: Page) {
  const { violations } = await new AxeBuilder({ page })
    .withTags(WCAG21_AA)
    // Astro's own dev toolbar isn't part of the studio.
    .exclude('astro-dev-toolbar')
    .analyze();
  expect(violations.map(({ id, nodes }) => ({ id, targets: nodes.map((n) => n.target) }))).toEqual(
    [],
  );
}

test.beforeEach(async ({ context, baseURL }) => {
  // Hermetic: map tiles and anything else off-site are blocked.
  const origin = baseURL ?? '';
  await context.route('**/*', (route) =>
    route.request().url().startsWith(origin) ? route.continue() : route.abort(),
  );
});

// Every test leaves the site as it found it, so a CI retry starts from the
// same files. Uploads never replace a file, so a second upload of the same
// name would otherwise be reused or numbered, not added.
test.afterEach(() => {
  for (const [path, bytes] of touched) {
    if (bytes === null) rmSync(`${site}${path}`, { force: true });
    else writeFileSync(`${site}${path}`, bytes);
  }
  touched.clear();
});

test('Appearance in the user menu: Dark is kept across a reload, and passes axe', async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/admin/');
  await expect(page.getByRole('heading', { level: 1, name: 'Content' })).toBeVisible();
  // Local mode's menu is named by git's user on this computer, or "You".
  const menu = page.getByRole('navigation', { name: 'Studio' }).getByRole('button').last();
  await menu.click();
  await expect(page.getByRole('menuitemradio', { name: 'System' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await page.getByRole('menuitemradio', { name: 'Dark' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  const background = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const dark = await background();
  await expectAccessible(page);

  await page.reload();
  // Applied by the page's own script, before the studio starts.
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByRole('heading', { level: 1, name: 'Content' })).toBeVisible();
  expect(await background()).toBe(dark);

  await menu.click();
  await page.getByRole('menuitemradio', { name: 'System' }).click();
  await expect(page.locator('html')).not.toHaveAttribute('data-theme', /./);
  expect(await background()).not.toBe(dark);
});

test('every screen passes axe: home, list, editor, media', async ({ page }) => {
  await page.goto('/admin/');
  await expect(page.getByRole('heading', { level: 1, name: 'Content' })).toBeVisible();
  await expect(page.getByText(/^4 entries/)).toBeVisible();
  await expectAccessible(page);

  await page.goto('/admin/#/c/blog');
  await expect(page.getByRole('grid', { name: 'Blog posts' })).toBeVisible();
  await expectAccessible(page);

  await page.goto('/admin/#/c/blog/e/harbor-at-dawn');
  await expect(page.getByRole('textbox', { name: 'Title' })).toHaveValue('Harbor at dawn');
  await expectAccessible(page);

  await page.goto('/admin/#/media');
  await expect(page.getByRole('heading', { level: 2, name: 'harbor-at-dawn.jpg' })).toBeVisible();
  await expectAccessible(page);
});

test('every screen passes axe in the dark theme too', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  const screens: [string, ReturnType<Page['getByRole']>][] = [
    ['/admin/', page.getByRole('heading', { level: 1, name: 'Content' })],
    ['/admin/#/c/blog', page.getByRole('grid', { name: 'Blog posts' })],
    ['/admin/#/c/pages', page.getByRole('treegrid', { name: 'Pages' })],
    ['/admin/#/c/blog/e/harbor-at-dawn', page.getByRole('textbox', { name: 'Body' })],
    ['/admin/#/media', page.getByRole('heading', { level: 2, name: 'harbor-at-dawn.jpg' })],
    ['/admin/#/redirects', page.getByRole('grid', { name: 'Redirects' })],
  ];
  for (const [path, ready] of screens) {
    await page.goto(path);
    await expect(ready).toBeVisible();
    await expectAccessible(page);
  }
});

test('by keyboard: Details is a drawer on a wide screen and the closing section on a narrow one', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/admin/#/c/blog/e/harbor-at-dawn');
  await expect(page.getByRole('textbox', { name: 'Title' })).toHaveValue('Harbor at dawn');
  // Wide: a button in the top bar opens the drawer, focus goes in and comes back.
  const button = page.getByRole('banner').getByRole('button', { name: 'Details', exact: true });
  await button.focus();
  await page.keyboard.press('Enter');
  const drawer = page.getByRole('dialog', { name: 'Details' });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByLabel('Published at')).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(drawer.locator(':focus')).toHaveCount(1);
  await expectAccessible(page);
  await page.keyboard.press('Escape');
  await expect(drawer).toBeHidden();
  await expect(button).toBeFocused();

  // Narrow (and at 200% zoom on a laptop): the same fields in a disclosure at the end.
  await page.setViewportSize({ width: 800, height: 900 });
  await expect(page.getByRole('banner').getByRole('button', { name: 'Details' })).toHaveCount(0);
  const section = page.getByRole('main').getByRole('button', { name: 'Details', exact: true });
  await expect(section).toHaveAttribute('aria-expanded', 'false');
  await section.focus();
  await page.keyboard.press('Enter');
  await expect(section).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByLabel('Published at')).toBeVisible();
  await expectAccessible(page);
});

test('by keyboard: the list beside the editor opens another entry, asks before leaving changes, and follows a save', async ({
  page,
}) => {
  touches('src/content/blog/welcome.md');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/admin/#/c/blog/e/harbor-at-dawn');
  const pane = page.getByRole('navigation', { name: 'Blog posts' });
  await expect(pane.getByRole('row', { name: /^Harbor at dawn.*open now$/ })).toBeVisible();
  await expectAccessible(page);

  // Enter on a row opens it, and focus lands on the new screen's heading.
  await pane.getByRole('row', { name: /^Welcome to the playground/ }).focus();
  await page.keyboard.press('Enter');
  const title = page.getByRole('textbox', { name: 'Title' });
  await expect(title).toHaveValue('Welcome to the playground');
  await expect(page.getByRole('heading', { level: 1 })).toBeFocused();

  // Unsaved changes ask first.
  await title.focus();
  await page.keyboard.press(keys.lineEnd);
  await page.keyboard.type(', again');
  await pane.getByRole('row', { name: /^Harbor at dawn/ }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('alertdialog', { name: 'Leave without saving?' })).toBeVisible();
  await page.getByRole('button', { name: 'Keep editing' }).click();
  await page.keyboard.press(keys.save);
  await expect(page.getByText('Saved just now')).toBeVisible();
  // The list follows the save.
  await expect(pane.getByRole('row', { name: /^Welcome to the playground, again/ })).toBeVisible();

  // Narrower, the editor is the single column again.
  await page.setViewportSize({ width: 1024, height: 900 });
  await expect(pane).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'List' })).toHaveCount(0);
});

test('a deep link survives a reload', async ({ page }) => {
  await page.goto('/admin/#/c/pages/e/academics%2Fnursing');
  await expect(page.getByRole('textbox', { name: 'Title' })).toBeVisible();
  await page.reload();
  await expect(page).toHaveURL(/#\/c\/pages\/e\/academics%2Fnursing$/);
  await expect(page.getByRole('textbox', { name: 'Title' })).toBeVisible();
});

test('by keyboard: open an entry from the list, edit, save with Ctrl+S; only that line changes', async ({
  page,
}) => {
  touches('src/content/blog/welcome.md');
  const before = read('src/content/blog/welcome.md');
  await page.goto('/admin/#/c/blog');
  const row = page.getByRole('row', { name: /Welcome to the playground/ });
  await row.focus();
  await page.keyboard.press('Enter');
  const title = page.getByRole('textbox', { name: 'Title' });
  await expect(title).toHaveValue('Welcome to the playground');
  await title.focus();
  await page.keyboard.press(keys.lineEnd);
  await page.keyboard.type(', again');
  await expect(page.getByRole('status').first()).toHaveText('Unsaved changes');
  await page.keyboard.press(keys.save);
  await expect(page.getByText('Saved just now')).toBeVisible();

  const after = read('src/content/blog/welcome.md');
  expect(after).toBe(
    before.replace(
      'title: "Welcome to the playground"',
      'title: "Welcome to the playground, again"',
    ),
  );
});

test('by keyboard: list items are rows that move with Alt+arrows and open in place; an edit changes one line', async ({
  page,
}) => {
  const path = 'src/content/pages/about.md';
  touches(path);
  const before = read(path);
  await page.goto('/admin/#/c/pages/e/about');
  await expect(page.getByRole('heading', { level: 2, name: /^Sections/ })).toBeVisible();
  const mission = page.getByRole('button', { name: /^Our mission/ });
  await expect(mission).toHaveAttribute('aria-expanded', 'false');
  await expectAccessible(page);

  // Alt+↓ and Alt+↑ move the item, and focus stays on its row.
  await mission.focus();
  await page.keyboard.press('Alt+ArrowDown');
  await expect(page.getByText('Moved Our mission to position 2 of 2.')).toBeAttached();
  await expect(mission).toBeFocused();
  await expect(page.getByRole('heading', { level: 3 })).toHaveText([
    /^Accreditation/,
    /^Our mission/,
  ]);
  await page.keyboard.press('Alt+ArrowUp');
  await expect(page.getByText('Moved Our mission to position 1 of 2.')).toBeAttached();
  await expect(mission).toBeFocused();

  // Enter opens it in place, and its fields are in the page.
  await page.keyboard.press('Enter');
  await expect(mission).toHaveAttribute('aria-expanded', 'true');
  const heading = page
    .getByRole('group', { name: 'Our mission' })
    .getByRole('textbox', { name: 'Heading' });
  await heading.focus();
  await page.keyboard.press(keys.lineEnd);
  await page.keyboard.type(' and values');
  await expectAccessible(page);
  await page.keyboard.press(keys.save);
  await expect(page.getByText('Saved just now')).toBeVisible();
  expect(read(path)).toBe(
    before.replace('- heading: Our mission\n', '- heading: Our mission and values\n'),
  );
});

test('the writing view rewrites only the paragraph that was edited', async ({ page }) => {
  const path = 'src/content/blog/harbor-at-dawn.md';
  touches(path);
  const before = read(path);
  await page.goto('/admin/#/c/blog/e/harbor-at-dawn');
  const body = page.getByRole('textbox', { name: 'Body' });
  await expect(body.getByText(/^Park by the old customs house/)).toBeVisible();
  // The paragraph is the body's last block, so the caret goes to the text's
  // end. The line's end is only the end of the visual line a click landed
  // on, which depends on how it wraps.
  await body.focus();
  await page.keyboard.press(keys.textEnd);
  await page.keyboard.type(' Bring a thermos.');
  await page.keyboard.press(keys.save);
  await expect(page.getByText('Saved just now')).toBeVisible();

  expect(read(path)).toBe(
    before.replace(
      'takes twenty minutes at an easy pace.',
      'takes twenty minutes at an easy pace. Bring a thermos.',
    ),
  );
});

test('a sideways phone photo is uploaded upright, without its location', async ({ page }) => {
  touches('src/assets/blog/portrait-exif-6.jpg');
  await page.goto('/admin/#/c/blog/e/harbor-at-dawn');
  await page.getByRole('button', { name: 'Replace image' }).click();
  const dialog = page.getByRole('dialog', { name: 'Choose an image' });
  await dialog.locator('input[type=file]').setInputFiles(`${fixtures}portrait-exif-6.jpg`);
  await expect(page.getByText(/Turned the photo upright\. Removed location data/)).toBeVisible();

  const uploaded = readFileSync(`${site}src/assets/blog/portrait-exif-6.jpg`);
  const facts = jpegFacts(new Uint8Array(uploaded));
  // Stored portrait now: 1200 wide, 1600 tall, with no EXIF orientation or GPS left.
  expect(facts).toMatchObject({ width: 1200, height: 1600, hasLocation: false });
  expect(facts.orientation).toBeUndefined();
});

test('an SVG with scripts is sanitized; HEIC is explained where it can’t be converted', async ({
  page,
}) => {
  touches('src/assets/script.svg');
  await page.goto('/admin/#/media');
  await expect(page.getByRole('heading', { level: 1, name: 'Media' })).toBeVisible();
  const input = page.locator('input[type=file]');

  await input.setInputFiles(`${fixtures}script.svg`);
  await expect(page.getByRole('status').filter({ hasText: 'Added' })).toContainText(
    'Removed scripts and unsafe links from the SVG',
  );
  const svg = read('src/assets/script.svg');
  expect(svg).not.toMatch(/<script|onload|javascript:|foreignObject/i);

  await input.setInputFiles(`${fixtures}iphone-gps.heic`);
  await expect(page.getByRole('alert')).toContainText('can’t convert iPhone (HEIC) photos');
});

test('a custom widget edits its field', async ({ page }) => {
  touches('src/data/locations.yaml');
  await page.goto('/admin/#/c/locations/e/main-campus');
  const hours = page.getByRole('group', { name: 'Hours (optional)' });
  await expect(hours.getByLabel('Days, row 1')).toHaveValue('Mon–Fri');
  await hours.getByRole('button', { name: 'Add opening hours' }).click();
  await hours.getByLabel('Days, row 3').fill('Holidays');
  await page.keyboard.press(keys.save);
  await expect(page.getByText('Saved just now')).toBeVisible();
  expect(read('src/data/locations.yaml')).toMatch(/days: Holidays/);
});

test('"Edit this page" knows which entries a page shows', async ({ page }) => {
  await page.goto('/blog/harbor-at-dawn/');
  const entries = JSON.parse(
    (await page.locator('#vesper-page-entries').textContent()) ?? '[]',
  ) as { collection: string; id: string; kind: string }[];
  expect(entries).toContainEqual(
    expect.objectContaining({ collection: 'blog', id: 'harbor-at-dawn', kind: 'shown' }),
  );
});
