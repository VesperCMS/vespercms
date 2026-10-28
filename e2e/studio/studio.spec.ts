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
  const menu = page.getByRole('banner').getByRole('button').last();
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
  // Among panes, the collections are the page, with their counts.
  const blog = page
    .getByRole('main', { name: 'Content' })
    .getByRole('link', { name: /^Blog posts/ });
  await expect(blog).toContainText('4');
  await expectAccessible(page);

  await page.goto('/admin/#/c/blog');
  await expect(page.getByRole('treegrid', { name: 'Blog posts' })).toBeVisible();
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
    ['/admin/#/c/blog', page.getByRole('treegrid', { name: 'Blog posts' })],
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

test('by keyboard: the entry’s tabs, Content and Details, at any width', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/admin/#/c/blog/e/harbor-at-dawn');
  await expect(page.getByRole('textbox', { name: 'Title' })).toHaveValue('Harbor at dawn');
  const content = page.getByRole('tab', { name: 'Content' });
  const details = page.getByRole('tab', { name: 'Details' });
  await expect(content).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByLabel('Published at')).toBeHidden();
  // Arrow keys move between tabs, and the chosen one shows its fields.
  await content.focus();
  await page.keyboard.press('ArrowRight');
  await expect(details).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByLabel('Published at')).toBeVisible();
  await expectAccessible(page);

  // Narrow (and at 200% zoom on a laptop): the same tabs, and the same one chosen.
  await page.setViewportSize({ width: 600, height: 900 });
  await expect(details).toHaveAttribute('aria-selected', 'true');
  await details.focus();
  await page.keyboard.press('ArrowLeft');
  await expect(content).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('textbox', { name: 'Summary' })).toBeVisible();
  await expectAccessible(page);
});

/** How many colours a screenshot holds, counted in the page, which can decode a PNG. */
async function colours(page: Page, png: Buffer): Promise<number> {
  return page.evaluate(
    async (bytes) => {
      const image = await createImageBitmap(
        new Blob([new Uint8Array(bytes)], { type: 'image/png' }),
      );
      const canvas = new OffscreenCanvas(image.width, image.height);
      const context = canvas.getContext('2d');
      if (!context) throw new Error('no 2d context');
      context.drawImage(image, 0, 0);
      const { data } = context.getImageData(0, 0, image.width, image.height);
      const seen = new Set<number>();
      for (let i = 0; i < data.length; i += 4) {
        seen.add(((data[i] ?? 0) << 16) | ((data[i + 1] ?? 0) << 8) | (data[i + 2] ?? 0));
      }
      return seen.size;
    },
    [...png],
  );
}

test('the top bar’s glass is clear above the lines between panes and strips, in both themes', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme });
    await page.goto('/admin/#/c/blog/e/harbor-at-dawn');
    await expect(page.getByRole('textbox', { name: 'Title' })).toHaveValue('Harbor at dawn');
    for (const folded of [false, true]) {
      if (folded) {
        await page.getByRole('button', { name: 'Collapse Content' }).click();
        await expect(page.getByRole('button', { name: 'Show Content' })).toBeFocused();
        await page.evaluate(() => {
          if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
        });
      }
      await page.mouse.move(0, 0);
      // Only the glass: the site's name and the user menu would be counted too.
      const banner = page.getByRole('banner');
      await banner.evaluate((bar) => {
        for (const child of bar.children) (child as HTMLElement).style.visibility = 'hidden';
      });
      const bar = await banner.boundingBox();
      if (!bar) throw new Error('no top bar');
      // Every pane and strip but the last, whose edge is the window's.
      const edges = await page
        .locator('[data-pane], [data-strip]')
        .evaluateAll((panes) => panes.slice(0, -1).map((p) => p.getBoundingClientRect().right));
      expect(edges).toHaveLength(2);
      for (const x of edges) {
        // The bar's own edges are left out: its lit top and its rim.
        const clip = { x: x - 16, y: bar.y + 4, width: 32, height: bar.height - 8 };
        expect(
          await colours(page, await page.screenshot({ clip })),
          `${colorScheme}, at ${String(x)}`,
        ).toBe(1);
      }
    }
    // Shown again for the next theme.
    await page.getByRole('button', { name: 'Show Content' }).click();
  }
});

test('on a phone, the editor’s bar keeps one row and one height as its status changes', async ({
  page,
}) => {
  touches('src/content/blog/welcome.md');
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto('/admin/#/c/blog/e/welcome');
  const title = page.getByRole('textbox', { name: 'Title' });
  await expect(title).toHaveValue('Welcome to the playground');
  const bar = page.getByRole('banner');
  const back = bar.getByRole('link', { name: 'Blog posts' });
  const save = bar.getByRole('button', { name: 'Save' });
  const shape = async () => ({
    bar: (await bar.boundingBox())?.height,
    back: (await back.boundingBox())?.y,
    save: await save.boundingBox(),
  });
  const before = await shape();
  // The way back and Save share the one row.
  expect(before.back).toBeLessThan((before.save?.y ?? 0) + (before.save?.height ?? 0));

  await title.focus();
  await page.keyboard.press(keys.lineEnd);
  await page.keyboard.type(', again');
  await expect(bar.getByRole('status')).toHaveText('Unsaved changes');
  expect(await shape()).toEqual(before);
  await page.keyboard.press(keys.save);
  await expect(bar.getByRole('status')).toHaveText(/^Saved/);
  expect(await shape()).toEqual(before);
  // Nothing runs past the window's edge.
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(375);
  await expectAccessible(page);
});

test('by keyboard: panes, full width: the collections, the list and the entry, folding when they don’t fit', async ({
  page,
}) => {
  touches('src/content/blog/welcome.md');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/admin/#/c/blog/e/harbor-at-dawn');
  const structure = page.getByRole('navigation', { name: 'Content' });
  const list = page.getByRole('navigation', { name: 'Blog posts' });
  await expect(structure.getByRole('link', { name: /Blog posts/ })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(list.getByRole('row', { name: /^Harbor at dawn.*open now$/ })).toBeVisible();
  await expectAccessible(page);
  // The panes fill the window, and the page itself never scrolls past them.
  expect(
    await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight),
  ).toBe(0);
  // Each pane scrolls beneath the top bar and its own header, which stay put as glass over
  // it, and a control focused from the bottom lands clear of both.
  const places = await page.getByRole('main').evaluate((pane) => {
    const header = pane.firstElementChild as HTMLElement;
    const bar = document.querySelector('header')?.getBoundingClientRect().bottom ?? 0;
    const before = header.getBoundingClientRect().top;
    pane.scrollTop = pane.scrollHeight;
    return {
      bar,
      before,
      after: header.getBoundingClientRect().top,
      bottom: header.getBoundingClientRect().bottom,
      content: (header.nextElementSibling as HTMLElement).getBoundingClientRect().top,
      glass: getComputedStyle(header).backdropFilter,
    };
  });
  expect(places.before).toBe(places.bar);
  expect(places.after).toBe(places.bar);
  expect(places.content).toBeLessThan(places.bar);
  expect(places.glass).toMatch(/blur/);
  await page.getByRole('textbox', { name: 'Title' }).focus();
  const focused = await page.getByRole('textbox', { name: 'Title' }).boundingBox();
  expect(focused?.y ?? 0).toBeGreaterThanOrEqual(places.bottom);

  // Enter on a row opens it beside the list, and focus lands on its heading.
  await list.getByRole('row', { name: /^Welcome to the playground/ }).focus();
  await page.keyboard.press('Enter');
  const title = page.getByRole('textbox', { name: 'Title' });
  await expect(title).toHaveValue('Welcome to the playground');
  await expect(page.getByRole('heading', { level: 1 })).toBeFocused();

  // Unsaved changes ask first.
  await title.focus();
  await page.keyboard.press(keys.lineEnd);
  await page.keyboard.type(', again');
  await list.getByRole('row', { name: /^Harbor at dawn/ }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('alertdialog', { name: 'Leave without saving?' })).toBeVisible();
  await page.getByRole('button', { name: 'Keep editing' }).click();
  await page.keyboard.press(keys.save);
  await expect(page.getByText('Saved just now')).toBeVisible();
  // The list follows the save.
  await expect(list.getByRole('row', { name: /^Welcome to the playground, again/ })).toBeVisible();

  // The collections are one click away: Pages opens beside them.
  await structure.getByRole('link', { name: /Pages/ }).click();
  await expect(
    page.getByRole('main').getByRole('heading', { level: 1, name: 'Pages' }),
  ).toBeVisible();
  await expectAccessible(page);

  // With no entry open the list is still a pane, with its tools.
  await structure.getByRole('link', { name: /Blog posts/ }).click();
  const whole = page.getByRole('main', { name: 'Blog posts' });
  await expect(whole.getByRole('treegrid', { name: 'Blog posts' })).toBeVisible();
  await expect(whole.getByRole('button', { name: /^Sort: / })).toBeVisible();
  await expect(whole.getByRole('link', { name: 'New entry' })).toBeVisible();
  await expectAccessible(page);

  // Any pane but the deepest collapses into a strip, and stays collapsed until it's shown again.
  await page.goto('/admin/#/c/blog/e/harbor-at-dawn');
  await structure.getByRole('button', { name: 'Collapse Content' }).focus();
  await page.keyboard.press('Enter');
  const show = page.getByRole('button', { name: 'Show Content' });
  await expect(show).toBeFocused();
  await page.reload();
  await expect(show).toBeVisible();
  await expect(structure).toHaveCount(0);
  await show.focus();
  await page.keyboard.press('Enter');
  await expect(structure.getByRole('button', { name: 'Collapse Content' })).toBeFocused();

  // Too narrow for every pane: the collections fold into a strip, which opens again.
  await page.goto('/admin/#/c/blog/e/harbor-at-dawn');
  await page.setViewportSize({ width: 1000, height: 800 });
  const strip = page.getByRole('button', { name: 'Show Content' });
  await expect(strip).toBeVisible();
  await expect(structure).toHaveCount(0);
  await strip.click();
  await expect(structure).toBeVisible();
  await expect(page.getByRole('button', { name: 'Show Blog posts' })).toBeVisible();
  await expectAccessible(page);

  // Narrower still: one screen at a time, with the top bar's menus.
  await page.setViewportSize({ width: 700, height: 900 });
  await expect(structure).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Blog posts' })).toBeVisible();

  // Wide again: the top bar comes back new, and the panes start below it, not beneath it.
  await page.setViewportSize({ width: 1280, height: 800 });
  const save = page.getByRole('main').getByRole('button', { name: 'Save' });
  await expect(save).toBeVisible();
  const bar = await page.getByRole('banner').boundingBox();
  const saveBox = await save.boundingBox();
  expect(saveBox?.y).toBeGreaterThanOrEqual((bar?.y ?? 0) + (bar?.height ?? 0));
  // Nothing covers it: a trial click checks that Save would get the click.
  await save.click({ trial: true });
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
  await expect(page.getByRole('main').getByRole('status').first()).toHaveText('Unsaved changes');
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

test('Duplicate opens a copy; its save is the original’s text with only the title changed', async ({
  page,
  context,
}) => {
  const original = 'src/content/blog/welcome.md';
  const copy = 'src/content/blog/welcome-to-the-playground-copy.md';
  touches(original, copy);
  const before = read(original);
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/admin/#/c/blog/e/welcome');
  await expect(page.getByRole('textbox', { name: 'Title' })).toHaveValue(
    'Welcome to the playground',
  );
  const more = page.getByRole('button', { name: 'More actions for Welcome to the playground' });
  await more.click();
  await page.getByRole('menuitem', { name: 'Copy editing link' }).click();
  await expect(page.getByRole('main').getByRole('status').first()).toHaveText('Link copied');
  await expect(more).toBeFocused();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(
    /\/admin\/#\/c\/blog\/e\/welcome$/,
  );

  // Where the clipboard refuses, the link is shown to copy by hand. Closing
  // that, or a confirmation, gives focus back to the menu's button.
  await page.evaluate(() => {
    navigator.clipboard.writeText = () => Promise.reject(new Error('Not allowed'));
  });
  await more.click();
  await page.getByRole('menuitem', { name: 'Copy editing link' }).click();
  const byHand = page.getByRole('dialog', { name: 'Copy the editing link' });
  await expect(byHand.getByRole('textbox', { name: 'Editing link' })).toBeFocused();
  await expectAccessible(page);
  await page.keyboard.press('Escape');
  await expect(more).toBeFocused();
  await more.click();
  await page.getByRole('menuitem', { name: 'Delete…' }).click();
  await expect(page.getByRole('alertdialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(more).toBeFocused();

  await more.click();
  await expectAccessible(page);
  await page.getByRole('menuitem', { name: 'Duplicate' }).click();
  await expect(page).toHaveURL(/#\/c\/blog\/e\/welcome\/copy$/);
  await expect(page.getByRole('textbox', { name: 'Title' })).toHaveValue(
    'Welcome to the playground (copy)',
  );
  await expect(
    page.getByRole('heading', { level: 1, name: 'New entry, a copy of Welcome to the playground' }),
  ).toBeFocused();
  await expect(page.getByRole('main').getByRole('status').first()).toHaveText('Not saved yet');
  await expectAccessible(page);
  await page.keyboard.press(keys.save);
  await expect(page).toHaveURL(/#\/c\/blog\/e\/welcome-to-the-playground-copy$/);

  expect(read(copy)).toBe(
    before.replace(
      'title: "Welcome to the playground"',
      'title: "Welcome to the playground (copy)"',
    ),
  );
  expect(read(original)).toBe(before);
});

test('by keyboard: list items are rows that move with Alt+arrows and open in place; a move moves their lines', async ({
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

  // Alt+↓ moves the item, and focus stays on its row.
  await mission.focus();
  await page.keyboard.press('Alt+ArrowDown');
  await expect(page.getByText('Moved Our mission to position 2 of 2.')).toBeAttached();
  await expect(mission).toBeFocused();
  await expect(page.getByRole('main').getByRole('heading', { level: 3 })).toHaveText([
    /^Accreditation/,
    /^Our mission/,
  ]);

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

  // Each item's lines moved as they are (the block scalar too), and the edit is the only other change.
  const missionLines = before.slice(
    before.indexOf('  - heading: Our mission'),
    before.indexOf('  - heading: Accreditation'),
  );
  const accreditationLines = before.slice(
    before.indexOf('  - heading: Accreditation'),
    before.indexOf('---', 4),
  );
  expect(read(path)).toBe(
    before.replace(
      missionLines + accreditationLines,
      accreditationLines + missionLines.replace('Our mission', 'Our mission and values'),
    ),
  );
});

test('by pointer: a row drags by its handle, open or closed; a drop moves only that item’s lines', async ({
  page,
}) => {
  const path = 'src/content/pages/about.md';
  touches(path);
  const before = read(path);
  await page.goto('/admin/#/c/pages/e/about');
  const mission = page.getByRole('button', { name: /^Our mission/ });
  const accreditation = page.getByRole('button', { name: /^Accreditation/ });
  await expect(mission).toBeVisible();
  // The handle is the pointer's alone, hidden from screen readers, so it's found by what it is.
  const handleOf = (row: typeof mission) =>
    page.getByRole('listitem').filter({ has: row }).locator('[draggable="true"]');
  await expectAccessible(page);

  // Let go below the middle of Accreditation, and Our mission lands under it.
  await handleOf(mission).dragTo(accreditation, { targetPosition: { x: 40, y: 40 } });
  await expect(page.getByText('Moved Our mission to position 2 of 2.')).toBeAttached();
  await expect(page.getByRole('main').getByRole('heading', { level: 3 })).toHaveText([
    /^Accreditation/,
    /^Our mission/,
  ]);
  await page.keyboard.press(keys.save);
  await expect(page.getByText('Saved just now')).toBeVisible();
  const missionLines = before.slice(
    before.indexOf('  - heading: Our mission'),
    before.indexOf('  - heading: Accreditation'),
  );
  const accreditationLines = before.slice(
    before.indexOf('  - heading: Accreditation'),
    before.indexOf('---', 4),
  );
  expect(read(path)).toBe(
    before.replace(missionLines + accreditationLines, accreditationLines + missionLines),
  );

  // Open, it drags the same way and stays open; dropped above Accreditation, the file is as it was.
  await mission.click();
  await expect(mission).toHaveAttribute('aria-expanded', 'true');
  await handleOf(mission).dragTo(accreditation, { targetPosition: { x: 40, y: 4 } });
  await expect(page.getByText('Moved Our mission to position 1 of 2.')).toBeAttached();
  await expect(mission).toHaveAttribute('aria-expanded', 'true');
  await expectAccessible(page);
  await page.keyboard.press(keys.save);
  await expect(page.getByText('Saved just now')).toBeVisible();
  expect(read(path)).toBe(before);
});

test('blocks: a kind added below a row and a kind changed in place write only their own lines', async ({
  page,
}) => {
  const path = 'src/content/pages/admissions/tuition.md';
  touches(path);
  const before = read(path);
  await page.goto('/admin/#/c/pages/e/admissions%2Ftuition');
  // Chromium names a row "Text , Paying in parts": the comma is a hidden span of its own.
  const text = page.getByRole('button', { name: /^Text\W+Paying in parts/ });
  await expect(text).toBeVisible();
  await expect(page.getByRole('button', { name: /^FAQ\W+Questions about cost/ })).toBeVisible();
  await expectAccessible(page);

  // An FAQ below the text block, from its row's menu: it opens, with focus in its first field.
  await text.focus();
  await page.keyboard.press('Shift+F10');
  await page.getByRole('menuitem', { name: 'Add below' }).click();
  await page.getByRole('menuitem', { name: 'FAQ' }).click();
  await expect(page.getByText('Added FAQ, block 2 of 3.')).toBeAttached();
  await page.keyboard.type('Paying for books');
  // The playground's FAQ needs its list of questions, so the new block gets one.
  await page.getByRole('button', { name: 'Add item' }).click();
  await page.keyboard.type('Can I pay monthly?');
  await page.keyboard.press('Tab');
  await page.keyboard.type('Yes, in four payments.');
  await expectAccessible(page);
  await page.keyboard.press(keys.save);
  await expect(page.getByText('Saved just now')).toBeVisible();
  const existing = '  - type: faq\n    heading: Questions about cost';
  const added = [
    '  - type: faq',
    '    heading: Paying for books',
    '    items:',
    '      - question: Can I pay monthly?',
    '        answer: Yes, in four payments.',
    '',
  ].join('\n');
  expect(read(path)).toBe(before.replace(existing, added + existing));

  // To Text: the heading carries over, and the questions go once the change is confirmed.
  const row = page.getByRole('button', { name: /^FAQ\W+Paying for books/ });
  await row.focus();
  await page.keyboard.press('Shift+F10');
  await page.getByRole('menuitem', { name: 'Change to' }).click();
  await page.getByRole('menuitem', { name: 'Text' }).click();
  const dialog = page.getByRole('alertdialog', { name: 'Change FAQ to Text?' });
  await expect(dialog).toContainText('Items has no place in Text, so it is removed.');
  await expectAccessible(page);
  await dialog.getByRole('button', { name: 'Change to Text' }).click();
  await expect(page.getByText('Changed to Text. Heading kept. Items removed.')).toBeAttached();
  const changed = page.getByRole('button', { name: /^Text\W+Paying for books/ });
  await expect(changed).toBeFocused();
  await page
    .getByRole('group', { name: /^Text\W+Paying for books/ })
    .getByRole('textbox', { name: 'Body' })
    .click();
  await page.keyboard.type('Four payments a year.');
  await page.keyboard.press(keys.save);
  await expect(page.getByText('Saved just now')).toBeVisible();
  const asText = [
    '  - type: text',
    '    heading: Paying for books',
    '    body: Four payments a year.',
    '',
  ].join('\n');
  expect(read(path)).toBe(before.replace(existing, asText + existing));
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

test('by keyboard: an icon field lists each icon beside its name; choosing one writes one line', async ({
  page,
}) => {
  const path = 'src/content/events/harvest-concert.md';
  touches(path);
  const before = read(path);
  await page.goto('/admin/#/c/events/e/harvest-concert');
  const icon = page.getByRole('combobox', { name: 'Icon (optional)' });
  await expect(icon).toHaveValue('');
  // The chosen icon's picture sits before its name, inside the field.
  const chosen = icon.locator('xpath=preceding-sibling::span[@aria-hidden="true"]');
  await expect(chosen).toHaveCount(0);

  // Typing filters the list. Each icon is beside its name, and only the name is read.
  await icon.focus();
  await page.keyboard.type('mu');
  const options = page.getByRole('listbox').getByRole('option');
  await expect(options).toHaveText(['music']);
  await expect(options.first()).toHaveAccessibleName('music');
  await expect(options.first().locator('span[aria-hidden="true"] svg')).toBeVisible();
  await expectAccessible(page);

  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(icon).toHaveValue('music');
  await expect(icon).toBeFocused();
  await expect(chosen.locator('svg')).toBeVisible();
  await expectAccessible(page);

  await page.keyboard.press(keys.save);
  await expect(page.getByRole('main').getByRole('status').first()).toHaveText(/Saved/);
  // The new key goes at the end of the frontmatter; nothing else changes.
  expect(read(path)).toBe(
    before.replace(
      'publishAt: 2026-10-31T08:00:00-04:00\n',
      'publishAt: 2026-10-31T08:00:00-04:00\nicon: music\n',
    ),
  );
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
