import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/*
 * Fields from the washcofair.com round, in a real browser and by keyboard:
 * a field that shows only while its sibling has a value (showWhen), and a
 * time of day (fields.time()). Nothing here saves, so the site copy is
 * never changed.
 */

const WCAG21_AA = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

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

test('a field shows while its sibling has the value, and says so', async ({ page }) => {
  await page.goto('/admin/#/c/events/e/harvest-concert');
  const online = page.getByRole('radio', { name: 'Online' });
  await expect(online).toBeVisible({ timeout: 20_000 });
  const stream = page.getByRole('textbox', { name: /Stream address/ });
  await expect(stream).toHaveCount(0);

  // By keyboard: focus the chosen option, and the arrow keys move the choice.
  await page.getByRole('radio', { name: 'In person' }).focus();
  await page.keyboard.press('ArrowDown');
  await expect(online).toBeChecked();
  await expect(stream).toBeVisible();
  await expect(page.getByText('Stream address is shown.')).toBeAttached();
  await expectAccessible(page);

  await page.keyboard.press('ArrowUp');
  await expect(stream).toHaveCount(0);
  await expect(page.getByText('Stream address is hidden.')).toBeAttached();
});

test('a time of day is the browser’s time picker', async ({ page }) => {
  await page.goto('/admin/#/c/events/e/harvest-concert');
  const doors = page.getByLabel(/Doors open/);
  await expect(doors).toBeVisible({ timeout: 20_000 });
  await expect(doors).toHaveAttribute('type', 'time');
  await doors.fill('18:30');
  await expect(doors).toHaveValue('18:30');
  await expectAccessible(page);
});
