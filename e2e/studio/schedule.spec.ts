import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/*
 * Scheduling in the studio, end to end (spec §6.17; Phase 4.5's step 3):
 * astro dev over a throwaway copy of the playground (scripts/studio-site.mjs).
 * The browser runs on Tokyo time, so every time it shows must be the site's
 * own, Eastern. The times are in 2099, ahead of any clock this runs on, and
 * the dev server's clock is the real one.
 */

test.use({ timezoneId: 'Asia/Tokyo' });

const site = fileURLToPath(new URL('../.studio-site/', import.meta.url));
const read = (path: string) => readFileSync(`${site}${path}`, 'utf8');
const WCAG21_AA = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

/** Files the running test changes, as they were before it (null: not there yet). */
const touched = new Map<string, Buffer | null>();
function touches(...paths: string[]) {
  for (const path of paths) {
    if (!touched.has(path)) {
      touched.set(path, existsSync(`${site}${path}`) ? readFileSync(`${site}${path}`) : null);
    }
  }
}

/**
 * axe at WCAG 2.1 AA, in the light theme and the dark one. Reduced motion
 * turns the studio's colour transitions off, so axe doesn't measure a
 * colour halfway through the switch.
 */
async function expectAccessible(page: Page) {
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
    const { violations } = await new AxeBuilder({ page })
      .withTags(WCAG21_AA)
      .exclude('astro-dev-toolbar')
      .analyze();
    expect(
      violations.map(({ id, nodes }) => ({ id, colorScheme, targets: nodes.map((n) => n.target) })),
    ).toEqual([]);
  }
  await page.emulateMedia({ colorScheme: 'light' });
}

test.beforeEach(async ({ context, baseURL }) => {
  const origin = baseURL ?? '';
  await context.route('**/*', (route) =>
    route.request().url().startsWith(origin) ? route.continue() : route.abort(),
  );
});

test.afterEach(() => {
  for (const [path, bytes] of touched) {
    if (bytes === null) rmSync(`${site}${path}`, { force: true });
    else writeFileSync(`${site}${path}`, bytes);
  }
  touched.clear();
});

test('schedules, reschedules and cancels when an event comes down, from the dialog and the view', async ({
  page,
}) => {
  const path = 'src/content/events/spring-commencement.md';
  touches(path);
  const before = read(path);
  await page.goto('/admin/#/c/events/e/spring-commencement');
  await expect(page.getByRole('textbox', { name: 'Title' })).toHaveValue('Spring commencement');

  // By keyboard: Publish ▾'s menu, then the dialog.
  await page.getByRole('button', { name: 'More ways to publish' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('menuitem', { name: 'Schedule…' })).toBeFocused();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Schedule' });
  await expect(dialog.getByText('Times are in Eastern Time, the site’s time zone.')).toBeVisible();
  // It's live already, so only when it comes down can be set.
  await expect(dialog.getByLabel('Goes live')).toHaveCount(0);
  const down = dialog.getByLabel('Comes down (optional)');
  await expect(down).toBeFocused();
  await down.fill('2099-03-08T02:30');
  await expect(down).toHaveAccessibleDescription(
    /2:30 AM doesn’t happen on Sun, Mar 8, 2099; this is 3:30 AM\./,
  );
  await page.keyboard.press('Tab');
  await page.keyboard.type('/events/');
  await expect(dialog.getByRole('textbox', { name: /Then send visitors to/ })).toHaveValue(
    '/events/',
  );
  await expect(
    dialog.getByText('Comes down the next time the site is built after Sun, Mar 8, 2099, 3:30 AM.'),
  ).toBeVisible();
  await expectAccessible(page);
  await dialog.getByRole('button', { name: 'Schedule' }).click();
  await expect(page.getByRole('main').getByRole('status').first()).toHaveText(
    /^Live until Sun, Mar 8, 2099, 3:30 AM · Saved/,
  );
  // Only the two lines the schedule needs are new.
  expect(read(path)).toBe(
    before.replace(
      'location: main-campus\n',
      'location: main-campus\nunpublishAt: 2099-03-08T03:30:00-04:00\nunpublishRedirect: /events/\n',
    ),
  );

  // Details shows it in words.
  await page.getByRole('tab', { name: 'Details' }).click();
  await expect(page.getByRole('group', { name: 'Schedule' })).toContainText(
    'Comes down Sun, Mar 8, 2099, 3:30 AM · then visitors go to /events/',
  );

  // The Scheduled view lists it; rescheduled there, then cancelled.
  await page.goto('/admin/#/scheduled');
  const row = page
    .getByRole('grid', { name: 'Scheduled changes' })
    .getByRole('row', { name: /Spring commencement/ });
  await expect(row).toContainText('Sun, Mar 8, 2099, 3:30 AM');
  await expect(row).toContainText('Comes down');
  await expectAccessible(page);
  const actions = row.getByRole('button', { name: 'Actions for Spring commencement, coming down' });
  await actions.click();
  await page.getByRole('menuitem', { name: 'Reschedule…' }).click();
  const again = page.getByRole('dialog', { name: 'Schedule' });
  await expect(again.getByLabel('Comes down (optional)')).toHaveValue('2099-03-08T03:30');
  await again.getByLabel('Comes down (optional)').fill('2099-06-01T17:00');
  await again.getByRole('button', { name: 'Schedule' }).click();
  await expect(page.getByText('“Spring commencement” is rescheduled.')).toBeVisible();
  expect(read(path)).toContain('unpublishAt: 2099-06-01T17:00:00-04:00\n');
  await expect(row).toContainText('Mon, Jun 1, 2099, 5:00 PM');
  // Focus is back on the row's menu button after the dialog.
  await expect(actions).toBeFocused();

  await actions.click();
  await page.getByRole('menuitem', { name: 'Cancel' }).click();
  await expect(page.getByText('“Spring commencement” no longer comes down.')).toBeVisible();
  // Cancelling takes the time and the redirect out again: the file is as it was.
  expect(read(path)).toBe(before);
  await expect(row).toHaveCount(0);
});

test('a scheduled entry’s own page says, in dev, that visitors won’t see it yet', async ({
  page,
}) => {
  const path = 'src/content/events/far-future-gala.md';
  touches(path);
  writeFileSync(
    `${site}${path}`,
    '---\ntitle: Far-future gala\nsummary: Much later.\nstartsAt: 2099-05-01T19:00:00-04:00\npublishAt: 2099-04-01T09:00:00-04:00\n---\n\nLater.\n',
  );
  // Astro's content layer picks the new file up.
  await expect
    .poll(async () => (await page.request.get('/events/far-future-gala/')).status(), {
      timeout: 15_000,
    })
    .toBe(200);
  await page.goto('/events/far-future-gala/');
  await expect(page.locator('#vesper-schedule-note')).toHaveText(
    'Scheduled · Wed, Apr 1, 2099, 9:00 AM. Visitors won’t see this page until then.',
  );
  const entries = JSON.parse(
    (await page.locator('#vesper-page-entries').textContent()) ?? '[]',
  ) as unknown[];
  expect(entries).toContainEqual(
    expect.objectContaining({
      id: 'far-future-gala',
      kind: 'shown',
      status: 'Scheduled · Wed, Apr 1, 2099, 9:00 AM',
      outside: true,
    }),
  );
  // A page whose entry is live has no note. (A tab of its own: the content
  // change reloads the open page.)
  const live = await page.context().newPage();
  await live.goto('/events/spring-commencement/');
  await expect(live.locator('h1')).toHaveText('Spring commencement');
  await expect(live.locator('#vesper-schedule-note')).toHaveCount(0);
});
