import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/*
 * Accessibility notes in the studio (spec §6.18, §11 Phase 2.8):
 * - every layer-1 rule fires on the playground's fixture, with its message
 *   beside the right field, PDF checks included (PDF.js in Chromium);
 * - the notes drawer can be operated fully by keyboard.
 * Nothing here saves, so the site copy is never changed.
 */

const FIXTURE = '/admin/#/c/fixtures/e/accessibility-mistakes';
const WCAG21_AA = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

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

test('every layer-1 rule fires on the fixture, beside the right field', async ({ page }) => {
  await page.goto(FIXTURE);
  // All 23 notes, PDFs included, once PDF.js has read the brochure.
  const count = page.getByRole('button', { name: '23 accessibility notes' });
  await expect(count).toBeVisible({ timeout: 20_000 });

  // Beside the colour field, in its description.
  await expect(page.getByRole('textbox', { name: /Text color/ })).toHaveAccessibleDescription(
    /Contrast 2\.3:1 against Page, light is below 4\.5:1\./,
  );
  // Beside the file field: what PDF.js read in the untagged brochure.
  const brochure = page.getByRole('button', { name: 'Replace file' });
  await expect(brochure).toHaveAccessibleDescription(/This PDF isn’t tagged/);
  await expect(brochure).toHaveAccessibleDescription(/This PDF has no document title\./);
  await expect(brochure).toHaveAccessibleDescription(
    /This PDF doesn’t say what language it’s in\./,
  );

  // Under the body, each naming what it's about.
  const body = page.getByRole('list', { name: 'Accessibility notes in the body' });
  const notes = await body.getByRole('listitem').allTextContents();
  const expected = [
    'Image “IMG_2041.jpg”: Alt text looks like a file name.',
    'Image “Image of the library steps”: Alt text doesn’t need to start with “Image of”.',
    'This alt text is 262 characters long.',
    'Image “favicon.svg”: Describe this image, or mark it decorative.',
    'Heading “A heading that skips level 3”: Heading jumps from level 2 to level 4.',
    'Heading “A second top-level heading”: The title is already the page’s main heading.',
    'Level 2 heading: This heading is empty.',
    'Link “click here”: Link text should say where it goes.',
    'Link “read more”: Link text should say where it goes.',
    'Link “https://example.com/programs”: Link text should say where it goes, not repeat its address.',
    'Link “Contact the welcome center”: Tell readers this opens in a new tab.',
    'Table: Add a header row so screen readers can announce columns.',
    'Paragraph “What to bring:”: This looks like a list. Format it as one.',
    'YouTube video needs a title.',
    'YouTube video: Confirm this video has captions.',
    'YouTube video “A campus walking tour”: Confirm this video has captions.',
    'PDF “course brochure”: This PDF isn’t tagged',
    'PDF “course brochure”: This PDF has no document title.',
    'PDF “course brochure”: This PDF doesn’t say what language it’s in.',
  ];
  expect(notes).toHaveLength(expected.length);
  expected.forEach((text, index) => {
    expect(notes[index]).toContain(text);
  });
  await expectAccessible(page);
});

test('Show puts the cursor on the note’s block', async ({ page }) => {
  await page.goto(FIXTURE);
  const body = page.getByRole('list', { name: 'Accessibility notes in the body' });
  const video = body.getByRole('listitem').filter({ hasText: 'YouTube video needs a title.' });
  await video.getByRole('button', { name: 'Show' }).click();
  await expect(page.getByRole('textbox', { name: 'Body' })).toBeFocused();
  // The card is selected, and said so.
  await expect(
    page.getByText('YouTube video selected. Press Enter for its settings.'),
  ).toBeAttached();
});

test('the notes drawer, by keyboard alone', async ({ page }) => {
  await page.goto(FIXTURE);
  const count = page.getByRole('button', { name: '23 accessibility notes' });
  await expect(count).toBeVisible({ timeout: 20_000 });

  // Enter opens it, with focus inside.
  await count.focus();
  await page.keyboard.press('Enter');
  const drawer = page.getByRole('dialog', { name: 'Accessibility notes' });
  await expect(drawer).toBeVisible();
  // React Aria focuses the dialog itself, so a screen reader reads its title first.
  await expect
    .poll(() => page.evaluate(() => Boolean(document.activeElement?.closest('[role=dialog]'))))
    .toBe(true);
  await expect(drawer.getByRole('heading', { level: 3 })).toHaveText([
    'Text color',
    'Brochure',
    'Body',
  ]);
  await expectAccessible(page);

  // Tab: the close button, then the first note's Go to field; Enter goes there.
  await page.keyboard.press('Tab');
  await expect(drawer.getByRole('button', { name: 'Close' })).toBeFocused();
  await page.keyboard.press('Tab');
  const first = page.locator(':focus');
  await expect(first).toHaveText('Go to field');
  await expect(first).toHaveAccessibleDescription(/Contrast 2\.3:1/);
  await page.keyboard.press('Enter');
  await expect(drawer).toBeHidden();
  await expect(page.getByRole('textbox', { name: /Text color/ })).toBeFocused();

  // Back to the count, and on through every note to a body note's Go to field.
  await count.focus();
  await page.keyboard.press('Enter');
  await expect(drawer).toBeVisible();
  const buttons = drawer.getByRole('button', { name: 'Go to field' });
  await expect(buttons).toHaveCount(23);
  await page.keyboard.press('Tab');
  for (let i = 0; i < 9; i++) await page.keyboard.press('Tab');
  // The ninth Go to field: the skipped heading (after the colour, three PDF and four image notes).
  await expect(page.locator(':focus')).toHaveAccessibleDescription(
    /Heading jumps from level 2 to level 4/,
  );
  await page.keyboard.press('Enter');
  await expect(drawer).toBeHidden();
  const editor = page.getByRole('textbox', { name: 'Body' });
  await expect(editor).toBeFocused();
  expect(
    await page.evaluate(() => {
      const anchor = window.getSelection()?.anchorNode;
      const element = anchor instanceof Element ? anchor : anchor?.parentElement;
      return element?.closest('h4')?.textContent;
    }),
  ).toBe('A heading that skips level 3');

  // Escape closes it, and focus goes back to the count.
  await count.focus();
  await page.keyboard.press('Enter');
  await expect(drawer).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(drawer).toBeHidden();
  await expect(count).toBeFocused();
});
