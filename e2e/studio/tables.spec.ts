import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { keys } from './keys.ts';

/*
 * Tables in the writing view (PLAN.md, "Tables in the writing view"), by
 * keyboard alone: a cell edited, rows and columns added, moved and deleted,
 * a column aligned, and Tab past the last cell. Each save is checked byte
 * for byte on disk: one change, one line, or one cell in each line.
 */

const site = fileURLToPath(new URL('../.studio-site/', import.meta.url));
const read = (path: string) => readFileSync(`${site}${path}`, 'utf8');
const WCAG21_AA = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const TUITION = 'src/content/pages/admissions/tuition.md';
const HOURS = 'src/content/docs/guides/opening-hours.mdoc';
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
  for (const path of [TUITION, HOURS]) {
    if (!original.has(path)) original.set(path, read(path));
  }
});

// Every test leaves the playground's text as it found it.
test.afterEach(() => {
  for (const [path, text] of original) writeFileSync(`${site}${path}`, text);
});

async function save(page: Page, path: string, expected: string) {
  await expect(page.getByText('Unsaved changes')).toBeVisible();
  await page.keyboard.press(keys.save);
  await expect.poll(() => read(path)).toBe(expected);
  // The file is written before the studio has the save's answer, and a save
  // pressed meanwhile would be the same save again.
  await expect(page.getByText('Saved just now')).toBeVisible();
}

/** The body editor, whose two statuses say what's selected and what a table did. */
const bodyRegion = (page: Page) => page.getByRole('region', { name: 'Body' });

/** Waits until the table's own status says this. */
async function said(page: Page, text: string) {
  await expect(bodyRegion(page).locator('div.sr-only[role="status"]')).toHaveText(text);
}

/** The cell with focus, by its text. */
async function focused(page: Page, text: string) {
  await expect(page.locator(':focus')).toHaveText(text);
}

/** Starts editing the focused cell and waits for its editor to have focus. */
async function edit(page: Page, name: string, key = 'Enter') {
  await page.keyboard.press(key);
  await expect(page.getByRole('textbox', { name })).toBeFocused();
}

/** Opens Table actions on the focused cell with Shift+F10. */
async function actions(page: Page) {
  await page.keyboard.press('Shift+F10');
  const menu = page.getByRole('menu', { name: 'Table actions' });
  await expect(menu).toBeVisible();
  return menu;
}

test('an aligned Markdown table: cells, rows, columns and alignment, each saved as its own lines', async ({
  page,
}) => {
  const before = read(TUITION);
  const table = [
    '| Charge               | Per credit hour |',
    '|:---------------------|----------------:|',
    '| In-state tuition     |            $285 |',
    '| Out-of-state tuition |            $610 |',
    '| Student services     |             $24 |',
  ];
  expect(before).toContain(table.join('\n'));
  const withTable = (lines: string[]) => before.replace(table.join('\n'), lines.join('\n'));

  await page.goto('/admin/#/c/pages/e/admissions%2Ftuition');
  const grid = page.getByRole('grid', { name: 'Table: Charge, Per credit hour' });
  await expect(grid).toBeVisible();
  // From the text, keys only: the arrow selects the table, Enter moves into its cells.
  const body = page.getByRole('textbox', { name: 'Body' });
  await body.focus();
  // The table is the body's last block, so the end of the text selects it.
  await page.keyboard.press(keys.textEnd);
  const selection = bodyRegion(page).locator('p.sr-only[role="status"]');
  const tableSelected = 'Table, 2 columns and 4 rows, selected. Press Enter to edit its cells.';
  await expect(selection).toHaveText(tableSelected);
  await page.keyboard.press('Enter');
  await focused(page, 'Charge');
  await expectAccessible(page);

  // A cell: padded to its right-aligned column, and nothing else changes.
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowRight');
  await focused(page, '$610');
  await edit(page, 'Per credit hour, row 3');
  await expectAccessible(page);
  for (let i = 0; i < 3; i++) await page.keyboard.press('Backspace');
  await page.keyboard.type('625');
  await page.keyboard.press('Enter');
  await focused(page, '$625');
  const edited = [...table];
  edited[3] = '| Out-of-state tuition |            $625 |';
  await save(page, TUITION, withTable(edited));

  // Tab past the last cell adds a row, written to the columns' widths.
  await page.keyboard.press('Control+End');
  await focused(page, '$24');
  await edit(page, 'Per credit hour, row 4', 'F2');
  await page.keyboard.press('Tab');
  await said(page, 'Row added.');
  await expect(page.getByRole('textbox', { name: 'Charge, row 5' })).toBeFocused();
  await page.keyboard.type('Lab fee');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('textbox', { name: 'Per credit hour, row 5' })).toBeFocused();
  await page.keyboard.type('$15');
  await page.keyboard.press('Enter');
  await focused(page, '$15');
  const added = [...edited, '| Lab fee              |             $15 |'];
  await save(page, TUITION, withTable(added));

  // Alt+↑ moves the row as its line; Delete row takes it out again.
  await page.keyboard.press('Alt+ArrowUp');
  await said(page, 'Row 5 moved up.');
  await save(page, TUITION, withTable([...edited.slice(0, 4), added[5] ?? '', edited[4] ?? '']));
  let menu = await actions(page);
  await expectAccessible(page);
  await menu.getByRole('menuitem', { name: 'Delete row' }).click();
  await said(page, 'Row 4 deleted.');
  await save(page, TUITION, withTable(edited));

  // Centred: the delimiter's cell changes, at the same width.
  menu = await actions(page);
  await menu.getByRole('menuitemradio', { name: 'Centre' }).click();
  await said(page, 'Column Per credit hour aligned centre.');
  const centred = [...edited];
  // `----------------:` is 17 characters, and stays so.
  centred[1] = `|:---------------------|:${'-'.repeat(15)}:|`;
  // The cell edited earlier is written anew, so it's padded as its column now aligns.
  centred[3] = '| Out-of-state tuition |      $625       |';
  await save(page, TUITION, withTable(centred));

  // A column: added, moved and deleted, changing one cell in each line.
  await page.keyboard.press('Control+Home');
  await page.keyboard.press('ArrowRight');
  await focused(page, 'Per credit hour');
  menu = await actions(page);
  await menu.getByRole('menuitem', { name: 'Insert column right' }).click();
  await said(page, 'Column added right of Per credit hour.');
  await edit(page, 'column 3, the header row');
  await page.keyboard.type('Notes');
  await page.keyboard.press('Enter');
  const notes = centred.map((line, i) =>
    i === 0 ? `${line} Notes |` : i === 1 ? `${line}---|` : `${line}  |`,
  );
  await save(page, TUITION, withTable(notes));
  await page.keyboard.press('Alt+ArrowLeft');
  await said(page, 'Column Notes moved left.');
  const swapped = notes.map((line) => {
    const [charge, price, added] = line.slice(1, -1).split('|');
    return `|${[charge, added, price].join('|')}|`;
  });
  await save(page, TUITION, withTable(swapped));
  menu = await actions(page);
  await menu.getByRole('menuitem', { name: 'Delete column' }).click();
  await said(page, 'Column Notes deleted.');
  await save(page, TUITION, withTable(centred));

  // Escape returns to the text with the table selected.
  await page.keyboard.press('Escape');
  await expect(selection).toHaveText(tableSelected);
  await expect(body).toBeFocused();
});

test('Markdoc tables: a cell beside a chip, the tables kept as written, and a new table from "/"', async ({
  page,
}) => {
  const before = read(HOURS);
  await page.goto('/admin/#/c/docs/e/guides%2Fopening-hours');
  await expect(page.getByRole('grid', { name: 'Table: Day, Hours' })).toBeVisible();
  // `{% table %}` waits for its own step (PLAN.md, call T3); `<br>` is HTML.
  await expect(page.getByText('Markdoc tag, kept as written.')).toBeVisible();
  await expect(page.getByText('Table, kept as written.')).toBeVisible();
  const services = page.getByRole('grid', { name: 'Table: Service, Where' });
  await expect(services.getByRole('gridcell', { name: 'The Abbreviation · WC' })).toBeVisible();

  // The cell inside the condition, beside the one with a chip.
  await services.getByRole('gridcell', { name: 'Campus tours' }).focus();
  await edit(page, 'Service, row 2');
  await page.keyboard.type(', daily');
  await page.keyboard.press('Enter');
  await focused(page, 'Campus tours, daily');
  const toured = before.replace(
    '| Campus tours | The {% abbr',
    '| Campus tours, daily | The {% abbr',
  );
  await save(page, HOURS, toured);

  // A new table from "/", at the end, its first cell being edited.
  const body = page.getByRole('textbox', { name: 'Body' });
  await body.focus();
  await page.keyboard.press(keys.textEnd);
  await page.keyboard.press('Enter');
  await page.keyboard.type('/tab');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('textbox', { name: 'column 1, the header row' })).toBeFocused();
  await page.keyboard.type('Room');
  await page.keyboard.press('Tab');
  await page.keyboard.type('Floor');
  await page.keyboard.press('Tab');
  await page.keyboard.type('Reading room');
  await page.keyboard.press('Tab');
  await page.keyboard.type('2');
  await page.keyboard.press('Escape');
  await focused(page, '2');
  await save(page, HOURS, `${toured}\n| Room | Floor |\n|---|---|\n| Reading room | 2 |\n`);
});
