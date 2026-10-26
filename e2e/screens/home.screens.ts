import { mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type Locator, type Page } from '@playwright/test';

/*
 * The studio's pictures on vespercms.com's home page, taken from the
 * playground in local mode: `npm run screens` (playwright.screens.config.ts).
 * Each shot is taken in the light and the dark theme, since the studio
 * follows the system's, and written to apps/site/src/assets/home/ as
 * <name>-light.png and <name>-dark.png.
 *
 * Every picture is 1800 × 1200 pixels (3:2). A shot names its frame, the
 * part of the screen it shows, in CSS pixels, and is taken at the scale
 * that makes the frame 1800 pixels wide: a close-up of one field comes out
 * larger than the whole studio, so it reads at the size the home page
 * shows it. Close-ups are cut from a window tall enough that their pane
 * doesn't scroll, so nothing sits under the panes' glass headers.
 *
 * Nothing here types or saves, and every picture shows a screen at rest:
 * no pointer over anything, no focus, fonts and images loaded.
 */

const OUT = fileURLToPath(new URL('../../apps/site/src/assets/home/', import.meta.url));
const PICTURE = { width: 1800, height: 1200 };
const THEMES = ['light', 'dark'] as const;
/** Tall enough that a whole entry lays out without its pane scrolling. */
const TALL = { width: 1200, height: 4200 };

type Point = { x: number; y: number };

type Shot = {
  name: string;
  /** The frame's width in CSS pixels; its height is two thirds of that. */
  frame: number;
  /** The window; the frame by default. */
  viewport?: { width: number; height: number };
  /** Panes folded into strips, as a viewer leaves them (kept in localStorage). */
  folded?: ('structure' | 'list')[];
  url: string;
  /**
   * Brings the screen to rest, and says where the frame's top left goes
   * when it isn't 0, 0. Shots choose edges that fall between lines of text.
   */
  prepare: (page: Page, frame: number) => Promise<Point | undefined>;
};

async function box(target: Locator) {
  const found = await target.boundingBox();
  if (!found) throw new Error('not on screen');
  return found;
}

/**
 * The top left of a frame `width` wide, centred across `column`, with its
 * top edge at `edge.top` or its bottom edge at `edge.bottom`, in whole
 * pixels so text stays crisp.
 */
async function place(
  width: number,
  column: Locator,
  edge: { top: number } | { bottom: number },
): Promise<Point> {
  const across = await box(column);
  const top = 'top' in edge ? edge.top : edge.bottom - (width * 2) / 3;
  return { x: Math.round(across.x + across.width / 2 - width / 2), y: Math.round(top) };
}

const topOf = async (target: Locator) => (await box(target)).y;
const bottomOf = async (target: Locator) => {
  const found = await box(target);
  return found.y + found.height;
};

/**
 * Puts the caret in `text` and leaves the body. When it loads, a body's
 * selection is its last block, which is drawn outlined; a click moves it
 * into the text, as an editor's first click does.
 */
async function settleBody(page: Page, text: Locator) {
  await text.click({ position: { x: 2, y: 2 } });
  await expect(page.getByRole('textbox', { name: 'Body' })).toBeFocused();
}

const shots: Shot[] = [
  {
    // Fields from the schema: title, the entry's tabs, a summary, and an
    // image field with its alt text, beside the collection's list.
    name: 'editor',
    frame: 1272,
    folded: ['structure'],
    url: '/admin/#/c/blog/e/harbor-at-dawn',
    prepare: async (page) => {
      await expect(page.getByRole('textbox', { name: 'Title' })).toHaveValue('Harbor at dawn');
      const hero = page.getByRole('group', { name: 'Hero (optional)' });
      await expect(hero.getByRole('textbox', { name: 'Alt text' })).toBeVisible();
      return undefined;
    },
  },
  {
    // Markdoc tags as blocks: two callouts, a video and a partial. 870
    // wide, the frame holds the whole body, from under the summary to just
    // above the keyboard hint.
    name: 'blocks',
    frame: 870,
    viewport: TALL,
    folded: ['structure', 'list'],
    url: '/admin/#/c/docs/e/guides%2Fwriting-callouts',
    prepare: async (page, frame) => {
      const body = page.getByRole('textbox', { name: 'Body' });
      await expect(body.getByText('Callout · Warning')).toBeVisible();
      await settleBody(page, body.getByText('Callouts hold a short paragraph'));
      const hint = page.getByText('Type / to insert a block', { exact: false });
      return place(frame, body, { bottom: (await topOf(hint)) - 4 });
    },
  },
  {
    // A page tree: the open page's ancestors unfold to show it. 945 wide,
    // the frame ends between two rows of the outline; the page beside it
    // scrolls a little, within its top margin, so the frame ends below a
    // switch rather than through it.
    name: 'outline',
    frame: 945,
    folded: ['structure'],
    url: '/admin/#/c/pages/e/academics%2Fnursing%2Fclinical-placements',
    prepare: async (page) => {
      const grid = page.getByRole('treegrid', { name: 'Pages' });
      await expect(grid.getByRole('row', { name: 'Clinical placements' })).toBeVisible();
      const title = page.getByRole('textbox', { name: 'Title' });
      await expect(title).toHaveValue('Clinical placements');
      await title.evaluate((field) => {
        let pane = field.parentElement;
        while (pane && !['auto', 'scroll'].includes(getComputedStyle(pane).overflowY)) {
          pane = pane.parentElement;
        }
        if (!pane) throw new Error('the editor has no scrolling pane');
        pane.scrollTop = 20;
      });
      return undefined;
    },
  },
  {
    // The focal point and the crops it makes, under the image field.
    name: 'focal',
    frame: 900,
    viewport: TALL,
    folded: ['structure', 'list'],
    url: '/admin/#/c/blog/e/harbor-at-dawn',
    prepare: async (page, frame) => {
      const hero = page.getByRole('group', { name: 'Hero (optional)' });
      const disclosure = hero.getByRole('button', { name: 'Focal point & crops' });
      await disclosure.click();
      await expect(hero.getByText('Wide · 16:9')).toBeVisible();
      return place(frame, hero, { top: (await topOf(disclosure)) - 24 });
    },
  },
  {
    // The body's accessibility notes under the end of the body: alt text,
    // headings and a vague link. 1029 wide, the frame ends after the link's
    // note and starts between the Video heading and the first video. Not
    // "a11y": the site's e2e keeps any file so named out of dist, for the report.
    name: 'notes',
    frame: 1029,
    viewport: TALL,
    folded: ['structure', 'list'],
    url: '/admin/#/c/fixtures/e/accessibility-mistakes',
    prepare: async (page, frame) => {
      // PDF.js reads the brochure before its notes join the others.
      await expect(page.getByRole('button', { name: '23 accessibility notes' })).toBeVisible({
        timeout: 30_000,
      });
      const body = page.getByRole('textbox', { name: 'Body' });
      await settleBody(page, body.getByRole('heading', { name: 'Video' }));
      const notes = page.getByRole('list', { name: 'Accessibility notes in the body' });
      const link = notes.getByRole('listitem').filter({ hasText: 'Link “click here”' });
      return place(frame, notes, { bottom: (await bottomOf(link)) + 6 });
    },
  },
  {
    // Site → Media: every image and file, with the pages that use it.
    name: 'media',
    frame: 1200,
    url: '/admin/#/media',
    prepare: async (page) => {
      await expect(
        page.getByRole('heading', { level: 2, name: 'harbor-at-dawn.jpg' }),
      ).toBeVisible();
      return undefined;
    },
  },
];

/** A PNG's width and height, from its header. */
function pngSize(path: string) {
  const bytes = readFileSync(path);
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

mkdirSync(OUT, { recursive: true });

for (const shot of shots) {
  for (const theme of THEMES) {
    test(`${shot.name}, ${theme}`, async ({ browser, baseURL }) => {
      const frame = { width: shot.frame, height: (shot.frame * 2) / 3 };
      const context = await browser.newContext({
        baseURL,
        viewport: shot.viewport ?? frame,
        deviceScaleFactor: PICTURE.width / frame.width,
        colorScheme: theme,
        reducedMotion: 'reduce',
      });
      // Hermetic, as in the studio tests: nothing loads from off the site.
      const origin = baseURL ?? '';
      await context.route('**/*', (route) =>
        route.request().url().startsWith(origin) ? route.continue() : route.abort(),
      );
      await context.addInitScript(
        (folded) => {
          localStorage.setItem('vesper:collapsed-panes', folded);
        },
        (shot.folded ?? []).join(','),
      );
      const page = await context.newPage();
      await page.goto(shot.url);
      await expect(page.getByRole('banner')).toBeVisible({ timeout: 60_000 });
      // Astro's dev toolbar isn't part of the studio.
      await page.addStyleTag({ content: 'astro-dev-toolbar { display: none !important; }' });

      const clip = { ...((await shot.prepare(page, frame.width)) ?? { x: 0, y: 0 }), ...frame };

      // At rest: no pointer over anything, nothing focused, fonts and images in.
      await page.mouse.move(0, 0);
      await page.evaluate(() => {
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      });
      await page.evaluate(() => document.fonts.ready);
      await page.waitForFunction(
        ({ x, y, width, height }) =>
          [...document.images].every((image) => {
            const at = image.getBoundingClientRect();
            const shown =
              at.width > 0 &&
              at.right > x &&
              at.left < x + width &&
              at.bottom > y &&
              at.top < y + height;
            return !shown || (image.complete && image.naturalWidth > 0);
          }),
        clip,
      );

      const path = `${OUT}${shot.name}-${theme}.png`;
      await page.screenshot({ path, clip, animations: 'disabled', caret: 'hide', scale: 'device' });
      expect(pngSize(path)).toEqual(PICTURE);
      await context.close();
    });
  }
}
