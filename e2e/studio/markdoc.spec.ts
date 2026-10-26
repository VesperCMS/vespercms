import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { keys } from './keys.ts';

/*
 * Phase 2.5 in a real browser, by keyboard alone: every tag in the
 * playground's Markdoc collection (callout, youtube, abbr, partial) is
 * inserted, configured, moved and removed without the mouse, and each save
 * is checked byte for byte on disk. A missing required attribute shows
 * inline and stops the save. MDX components declared in vesper.config.ts
 * get the same settings.
 */

const site = fileURLToPath(new URL('../.studio-site/', import.meta.url));
const read = (path: string) => readFileSync(`${site}${path}`, 'utf8');
const write = (path: string, text: string) => {
  writeFileSync(`${site}${path}`, text);
};
const WCAG21_AA = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const DOC = 'src/content/docs/guides/writing-callouts.mdoc';
const MDX = 'src/content/pages/campus-life.mdx';
const PARTIAL = '{% partial file="../_support-hours.mdoc" /%}';
const original = new Map<string, string>();

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
  for (const path of [DOC, MDX]) {
    if (!original.has(path)) original.set(path, read(path));
  }
  // The guide ends with a partial; a last line of text gives the keyboard a
  // place to start (the text's end, then Enter for a new line).
  write(DOC, `${original.get(DOC) ?? ''}\nLast line.\n`);
});

/** Pages that reloaded after the test opened the guide. */
const reloaded = new WeakSet<Page>();

// Every test leaves the playground's text as it found it.
test.afterEach(({ page }) => {
  for (const [path, text] of original) write(path, text);
  // astro dev reloads /admin when a file the studio is built from changes,
  // say an edit to packages/ while the tests run. The unsaved edits go with
  // the page, and the next save then looks lost; this names the real cause.
  expect(reloaded.has(page), 'The studio reloaded mid-test and lost its edits').toBe(false);
});

/** Opens the writing-callouts guide with the caret at the end of its body. */
async function openAtEnd(page: Page) {
  await page.goto('/admin/#/c/docs/e/guides%2Fwriting-callouts');
  const body = page.getByRole('textbox', { name: 'Body' });
  await expect(body).toBeVisible();
  // Focus the text, as Tab would; from here on, keys only.
  await body.focus();
  await moveCaret(page, keys.textEnd);
  page.on('load', () => reloaded.add(page));
}

/** Opens the writing-callouts guide on a new, empty line at the end of its body. */
async function openOnNewLine(page: Page) {
  await openAtEnd(page);
  await page.keyboard.press('Enter');
}

async function save(page: Page, expected: string) {
  await page.keyboard.press(keys.save);
  await expect.poll(() => read(DOC)).toBe(expected);
}

/** Waits until the live region says which block is selected, so the next key acts on it. */
async function selected(page: Page, label: string) {
  await expect(page.getByRole('main').locator('p.sr-only[role="status"]')).toHaveText(
    `${label} selected. Press Enter for its settings.`,
  );
}

/**
 * Presses a key that moves the caret (`keys.lineStart`, `keys.lineEnd`) and
 * waits for its selectionchange. Off a Mac the browser moves it, and
 * ProseMirror learns of native caret moves from that event; a paste or arrow
 * key sent before it lands would act on the old caret.
 */
async function moveCaret(page: Page, key: string) {
  await page.evaluate(() => {
    const scope = window as { caretMoved?: Promise<void> };
    scope.caretMoved = new Promise((resolve) => {
      document.addEventListener('selectionchange', () => setTimeout(resolve, 0), { once: true });
      setTimeout(resolve, 2000);
    });
  });
  await page.keyboard.press(key);
  await page.evaluate(() => (window as { caretMoved?: Promise<void> }).caretMoved);
}

/** The guide with `block` moved above its last line. */
const aboveLastLine = (before: string, block: string) =>
  before.replace('\nLast line.\n', `\n${block}\n\nLast line.\n`);

test('a selected block is outlined only while the text has focus; Insert is there from the start', async ({
  page,
}) => {
  await page.goto('/admin/#/c/docs/e/guides%2Fwriting-callouts');
  page.on('load', () => reloaded.add(page));
  const body = page.getByRole('textbox', { name: 'Body' });
  const partial = body.getByRole('group', { name: /^Partial/ });
  const outline = () => partial.evaluate((block) => getComputedStyle(block).outlineStyle);
  // As the entry opens nothing has focus, and the caret waits in the first text.
  await expect(
    page.getByRole('toolbar', { name: 'Formatting' }).getByRole('button', { name: /Insert/ }),
  ).toBeVisible();
  await expect.poll(outline).toBe('none');

  // From the last line, up onto the partial: selected, and outlined.
  await body.focus();
  await moveCaret(page, keys.textEnd);
  await page.keyboard.press('ArrowUp');
  await selected(page, 'Partial');
  await expect.poll(outline).toBe('solid');
  // Still selected once focus moves on, but no longer drawn so.
  await page.getByRole('textbox', { name: 'Title' }).focus();
  await expect.poll(outline).toBe('none');
});

test('a callout: inserted with "/", configured, moved and removed by keyboard alone', async ({
  page,
}) => {
  const before = read(DOC);
  await openOnNewLine(page);
  await page.keyboard.type('/call');
  const combobox = page.getByRole('combobox', { name: 'Body' });
  await expect(combobox).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByRole('listbox', { name: 'Insert a block' })).toBeVisible();
  await expectAccessible(page);
  await page.keyboard.press('Enter');

  const dialog = page.getByRole('dialog', { name: 'Callout settings' });
  await expect(dialog).toBeVisible();
  // Focus starts on the chosen type (the default, Note); the arrows change it.
  await expect(dialog.getByRole('radio', { name: 'Note' })).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(dialog.getByRole('radio', { name: 'Warning' })).toBeChecked();
  await page.keyboard.press('Tab');
  await page.keyboard.type('Mind the gap');
  await expectAccessible(page);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();

  const callout = '{% callout type="warning" title="Mind the gap" %}\n{% /callout %}';
  await save(page, `${before}\n${callout}\n`);

  // Still selected: Alt+Up moves it above the last line.
  await selected(page, 'Callout');
  await page.keyboard.press('Alt+ArrowUp');
  await save(page, aboveLastLine(before, callout));

  // Delete removes it, and the file is as it was.
  await selected(page, 'Callout');
  await page.keyboard.press('Delete');
  await save(page, before);
});

test('a YouTube video: inserted from the toolbar, configured by Enter, moved and removed', async ({
  page,
}) => {
  const before = read(DOC);
  await openOnNewLine(page);
  // Escape leaves the text for the toolbar; the arrows reach Insert.
  await page.keyboard.press('Escape');
  for (let i = 0; i < 10; i++) await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('button', { name: /^Insert/ })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('menuitem', { name: 'YouTube video' })).toBeVisible();
  await expectAccessible(page);
  // Past Abbreviation, Callout, Partial and Table, in the menu's order.
  for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menuitem', { name: 'YouTube video' })).toBeFocused();
  await page.keyboard.press('Enter');

  const dialog = page.getByRole('dialog', { name: 'YouTube video settings' });
  await expect(dialog.getByRole('textbox', { name: /Video ID/ })).toBeFocused();
  await page.keyboard.type('VsprDemo009');
  await page.keyboard.press('Tab');
  await page.keyboard.type('Installing in two minutes');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  const video = '{% youtube id="VsprDemo009" title="Installing in two minutes" /%}';
  await save(page, `${before}\n${video}\n`);

  // Selected after its settings close: Enter opens them again.
  await selected(page, 'YouTube video');
  await page.keyboard.press('Enter');
  await expect(dialog.getByRole('textbox', { name: /Video ID/ })).toBeFocused();
  await page.keyboard.press('Tab');
  await page.keyboard.press(keys.lineEnd);
  await page.keyboard.type(', with captions');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Space');
  await expect(dialog.getByRole('switch', { name: 'The video has captions' })).toBeChecked();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  const configured =
    '{% youtube id="VsprDemo009" title="Installing in two minutes, with captions" captions=true /%}';
  await save(page, `${before}\n${configured}\n`);

  await selected(page, 'YouTube video');
  await page.keyboard.press('Alt+ArrowUp');
  await save(page, aboveLastLine(before, configured));
  await selected(page, 'YouTube video');
  await page.keyboard.press('Alt+ArrowDown');
  await save(page, `${before}\n${configured}\n`);
  await selected(page, 'YouTube video');
  await page.keyboard.press('Delete');
  await save(page, before);
});

test('an abbreviation: inserted inline, configured, moved with cut and paste, and removed', async ({
  page,
  context,
}) => {
  // Cut and paste by keyboard go through the system clipboard.
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const before = read(DOC);
  await openOnNewLine(page);
  await page.keyboard.type('Use it in the ');
  await page.keyboard.type('/abb');
  await expect(page.getByRole('option', { name: /Abbreviation/ })).toBeVisible();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Abbreviation settings' });
  await expect(dialog.getByRole('textbox', { name: /Full form/ })).toBeFocused();
  await page.keyboard.type('content management system');
  await page.keyboard.press('Tab');
  await page.keyboard.type('CMS');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  const abbr = '{% abbr title="content management system" %}CMS{% /abbr %}';
  await save(page, `${before}\nUse it in the ${abbr}\n`);

  // Moved by keyboard: from the line's end, the left arrow selects the chip;
  // cut it, go to the line's start, paste.
  await moveCaret(page, keys.lineEnd);
  await page.keyboard.press('ArrowLeft');
  await selected(page, 'Abbreviation');
  await page.keyboard.press(keys.cut);
  await moveCaret(page, keys.lineStart);
  await page.keyboard.press(keys.paste);
  await save(page, `${before}\n${abbr}Use it in the\n`);

  // Removed: from the line's start, the right arrow selects it; Delete removes it.
  await moveCaret(page, keys.lineStart);
  await page.keyboard.press('ArrowRight');
  await selected(page, 'Abbreviation');
  await page.keyboard.press('Delete');
  await save(page, `${before}\nUse it in the\n`);
});

test('abbreviations at both ends of a line: ⌘← and ⌘→ go past them', async ({ page }) => {
  test.skip(process.platform !== 'darwin', '⌘← and ⌘→ are macOS line keys');
  // Written to the file: "/" on an empty line inserts the tag as a block.
  const abbr = '{% abbr title="content management system" %}CMS{% /abbr %}';
  write(DOC, read(DOC).replace('\nLast line.\n', `\n${abbr} and ${abbr}\n`));
  await openAtEnd(page);
  // An empty status means no chip is selected, so `selected` below can't
  // pass on what an earlier key announced.
  const status = page.getByRole('main').locator('p.sr-only[role="status"]');

  // The caret right after the first chip, put there the way the browser
  // moves it (inside the text that follows), then ⌘←. The right arrow then
  // selects the chip only if the caret went before it.
  await moveCaret(page, keys.lineEnd);
  await page.keyboard.press('ArrowLeft');
  await selected(page, 'Abbreviation');
  await page.keyboard.press('ArrowLeft');
  for (let i = 0; i < ' and '.length; i++) await moveCaret(page, 'ArrowLeft');
  await expect(status).toHaveText('');
  await moveCaret(page, 'Meta+ArrowLeft');
  await page.keyboard.press('ArrowRight');
  await selected(page, 'Abbreviation');

  // The same at the other end: right before the last chip, then ⌘→.
  await page.keyboard.press('ArrowRight');
  for (let i = 0; i < ' and '.length; i++) await moveCaret(page, 'ArrowRight');
  await expect(status).toHaveText('');
  await moveCaret(page, 'Meta+ArrowRight');
  await page.keyboard.press('ArrowLeft');
  await selected(page, 'Abbreviation');
});

test('abbreviations mid-line: ⇧⌘← and ⇧⌘→ select past them to the ends of the line', async ({
  page,
}) => {
  test.skip(process.platform !== 'darwin', '⇧⌘← and ⇧⌘→ are macOS line keys');
  const abbr = '{% abbr title="content management system" %}CMS{% /abbr %}';
  const line = `From ${abbr} to ${abbr} end.`;
  const before = read(DOC).replace('\nLast line.\n', `\n${line}\n`);
  write(DOC, before);
  await openAtEnd(page);
  const status = page.getByRole('main').locator('p.sr-only[role="status"]');

  // The caret right after the first chip, arrowed to through the text, then
  // ⇧⌘←. A letter typed next replaces the selection, so the saved line shows
  // how far it reached; ProseMirror's own step selected only the chip.
  for (let i = 0; i < ' end.'.length; i++) await moveCaret(page, 'ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await selected(page, 'Abbreviation');
  await page.keyboard.press('ArrowLeft');
  for (let i = 0; i < ' to '.length; i++) await moveCaret(page, 'ArrowLeft');
  await expect(status).toHaveText('');
  await moveCaret(page, 'Shift+Meta+ArrowLeft');
  await page.keyboard.type('X');

  // The same the other way: right before the last chip, then ⇧⌘→.
  for (let i = 0; i < ' to '.length; i++) await moveCaret(page, 'ArrowRight');
  await expect(status).toHaveText('');
  await moveCaret(page, 'Shift+Meta+ArrowRight');
  await page.keyboard.type('Y');
  await save(page, before.replace(line, 'X to Y'));
});

test('a partial: inserted pointing at the nearest partial file, moved and removed', async ({
  page,
}) => {
  // Start without the guide's own partial, then put one back by keyboard.
  write(DOC, read(DOC).replace(`${PARTIAL}\n\n`, ''));
  const before = read(DOC);
  await openOnNewLine(page);
  await page.keyboard.type('/part');
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Partial settings' });
  await expect(dialog.getByRole('button', { name: /File/ })).toContainText(
    'src/content/docs/_support-hours.mdoc',
  );
  await expectAccessible(page);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await save(page, `${before}\n${PARTIAL}\n`);
  await selected(page, 'Partial');
  await page.keyboard.press('Alt+ArrowUp');
  await save(page, aboveLastLine(before, PARTIAL));
  await selected(page, 'Partial');
  await page.keyboard.press('Delete');
  await save(page, before);
});

test('a missing required attribute shows on its block and stops the save', async ({ page }) => {
  const before = read(DOC);
  await openOnNewLine(page);
  await page.keyboard.type('/you');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  const card = page.getByRole('group', { name: 'YouTube video', exact: true });
  await expect(card).toContainText('YouTube video: Video ID is required.');
  await expect(card).toContainText('YouTube video: Title is required.');
  await page.keyboard.press(keys.save);
  const summary = page.getByRole('alert');
  await expect(summary).toContainText('The entry wasn’t saved');
  await expect(summary).toContainText('YouTube video: Title is required.');
  await expect(summary).toBeFocused();
  await expectAccessible(page);
  expect(read(DOC)).toBe(before);
});

test('a declared MDX component: its props come from its Zod schema', async ({ page }) => {
  const before = read(MDX);
  await page.goto('/admin/#/c/pages/e/campus-life');
  await expect(page.getByRole('group', { name: 'Callout · Tip' })).toBeVisible();
  await expect(page.getByText(/^Component, kept as written/)).toBeVisible();
  await page.getByRole('button', { name: 'Settings for Callout' }).click();
  const dialog = page.getByRole('dialog', { name: 'Callout settings' });
  await expect(dialog.getByRole('radio', { name: 'Tip' })).toBeFocused();
  // Tip is last: the left arrow reaches Warning.
  await page.keyboard.press('ArrowLeft');
  await expectAccessible(page);
  await page.keyboard.press('Escape');
  await page.keyboard.press(keys.save);
  await expect
    .poll(() => read(MDX))
    .toBe(
      before.replace(
        '<Callout type="tip" title="Visiting?">',
        '<Callout type="warning" title="Visiting?">',
      ),
    );
});
