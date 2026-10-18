import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/*
 * Focal points and crops in the studio (spec §6.6.4, §11 Phase 2.7):
 * - the focal point and the crop box can be set by keyboard alone, and
 *   every change is announced;
 * - the image file is byte-identical after any focal-point or crop edit:
 *   the entry is the only file that changes.
 */

const site = fileURLToPath(new URL('../.studio-site/', import.meta.url));
const entry = 'src/content/blog/harbor-at-dawn.md';
const read = (path: string) => readFileSync(`${site}${path}`, 'utf8');
const WCAG21_AA = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

const touched = new Map<string, Buffer | null>();
function touches(...paths: string[]) {
  for (const path of paths) {
    if (!touched.has(path)) {
      touched.set(path, existsSync(`${site}${path}`) ? readFileSync(`${site}${path}`) : null);
    }
  }
}

/** SHA-256 of every file under the site's src/, by path. */
function sourceHashes(): Record<string, string> {
  const root = join(site, 'src');
  const found: Record<string, string> = {};
  for (const item of readdirSync(root, { recursive: true, withFileTypes: true })) {
    if (!item.isFile()) continue;
    const path = join(item.parentPath, item.name);
    found[`src/${relative(root, path).split('\\').join('/')}`] = createHash('sha256')
      .update(readFileSync(path))
      .digest('hex');
  }
  return found;
}

async function expectAccessible(page: Page) {
  const { violations } = await new AxeBuilder({ page })
    .withTags(WCAG21_AA)
    .exclude('astro-dev-toolbar')
    .analyze();
  expect(violations.map(({ id, nodes }) => ({ id, targets: nodes.map((n) => n.target) }))).toEqual(
    [],
  );
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

test('the focal point and crops, by keyboard alone; only the entry changes', async ({ page }) => {
  touches(entry);
  const before = read(entry);
  const sourcesBefore = sourceHashes();
  await page.goto('/admin/#/c/blog/e/harbor-at-dawn');
  const hero = page.getByRole('group', { name: 'Hero' });
  const disclosure = hero.getByRole('button', { name: 'Focal point & crops' });
  await expect(disclosure).toHaveAttribute('aria-expanded', 'false');

  // Open the disclosure, then Tab to the focal point.
  await disclosure.focus();
  await page.keyboard.press('Enter');
  await expect(disclosure).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('Tab');
  const control = hero.getByRole('button', { name: 'Focal point', exact: true });
  await expect(control).toBeFocused();
  await expect(control).toHaveAccessibleDescription(/^62% across, 35% down/);

  // 1% steps, 10% with Shift, each announced.
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Shift+ArrowDown');
  await expect(hero.getByRole('status').filter({ hasText: 'Focal point' })).toHaveText(
    'Focal point 65% across, 45% down.',
  );
  await expect(hero.getByRole('spinbutton', { name: 'Across (%)' })).toHaveValue('65');
  await expect(hero.getByRole('spinbutton', { name: 'Down (%)' })).toHaveValue('45');
  await expectAccessible(page);

  // Across, Down, "Use the center", then the first crop's button.
  for (let i = 0; i < 4; i++) await page.keyboard.press('Tab');
  await expect(hero.getByRole('button', { name: 'Adjust crop for Wide' })).toBeFocused();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Adjust the Wide crop' });
  const box = dialog.getByRole('application', { name: 'Crop box for Wide (16:9)' });
  await expect(box).toBeFocused();
  await expectAccessible(page);

  // Shift+← shrinks the box around its centre, → moves it; each change is announced.
  for (let i = 0; i < 10; i++) await page.keyboard.press('Shift+ArrowLeft');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect(dialog.getByRole('status')).toHaveText(
    'Crop 7% from the left, 7% from the top, 90% of the width.',
  );
  await page.keyboard.press('Enter');
  await expect(dialog).toBeHidden();
  await expect(hero.getByRole('button', { name: 'Adjust crop for Wide' })).toBeFocused();
  await expect(hero.getByRole('listitem').first()).toContainText('Wide · 16:9 · Custom crop');

  await page.keyboard.press('Control+s');
  await expect(page.getByText('Saved just now')).toBeVisible();
  // Only the focal point's two values changed, and the wide crop was added in
  // the square crop's style: every other byte is as it was.
  const square = '    square: { x: 0.40, y: 0.10, w: 0.45, h: 0.675 }';
  const wide = '    wide: { x: 0.07, y: 0.0703, w: 0.9, h: 0.7594 }';
  const moved = before.replace('  focus: { x: 0.62, y: 0.35 }', '  focus: { x: 0.65, y: 0.45 }');
  expect(read(entry)).toBe(moved.replace(square, `${square}\n${wide}`));

  // Reset the square crop: Tab to its button, then from the box to "Reset to focal point".
  await page.keyboard.press('Tab');
  await expect(hero.getByRole('button', { name: 'Adjust crop for Square' })).toBeFocused();
  await page.keyboard.press('Enter');
  const squareDialog = page.getByRole('dialog', { name: 'Adjust the Square crop' });
  await expect(squareDialog.getByRole('application')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(squareDialog.getByRole('button', { name: 'Reset to focal point' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(squareDialog).toBeHidden();
  await expect(hero.getByText('Square crop reset to the focal point.')).toBeAttached();
  await page.keyboard.press('Control+s');
  await expect(page.getByText('Saved just now')).toBeVisible();
  await expect.poll(() => read(entry)).toBe(moved.replace(square, wide));

  // The image and every other file are byte for byte what they were.
  const sourcesAfter = sourceHashes();
  expect({ ...sourcesAfter, [entry]: '' }).toEqual({ ...sourcesBefore, [entry]: '' });
  expect(sourcesAfter['src/assets/blog/harbor-at-dawn.jpg']).toBe(
    sourcesBefore['src/assets/blog/harbor-at-dawn.jpg'],
  );
});

test('a click sets the focal point, and Escape leaves a crop as it was', async ({ page }) => {
  touches(entry);
  const before = read(entry);
  await page.goto('/admin/#/c/blog/e/harbor-at-dawn');
  const hero = page.getByRole('group', { name: 'Hero' });
  await hero.getByRole('button', { name: 'Focal point & crops' }).click();
  const image = hero.getByRole('button', { name: 'Focal point', exact: true }).locator('img');
  const bounds = await image.boundingBox();
  if (!bounds) throw new Error('the image has no box');
  // A quarter across, three quarters down.
  await page.mouse.click(bounds.x + bounds.width / 4, bounds.y + (bounds.height * 3) / 4);
  await expect(hero.getByRole('spinbutton', { name: 'Across (%)' })).toHaveValue('25');
  await expect(hero.getByRole('spinbutton', { name: 'Down (%)' })).toHaveValue('75');

  await hero.getByRole('button', { name: 'Adjust crop for Square' }).click();
  const dialog = page.getByRole('dialog', { name: 'Adjust the Square crop' });
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(hero.getByRole('listitem').nth(1)).toContainText('Square · 1:1 · Custom crop');
  // Only the focal point changed; nothing is saved until Save.
  expect(read(entry)).toBe(before);
});
