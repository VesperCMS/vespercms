import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import sharp from 'sharp';

/*
 * Phase 2.7's crops, in the built playground on the plain static host
 * (spec §11 Phase 2.7):
 * - the hero renders the right crop at every declared ratio, and the manual
 *   square crop applies to the square ratio only;
 * - art direction is a valid <picture>, each source cropped for its ratio,
 *   and the browser picks the right one for the screen.
 *
 * Every served image is compared, pixel by pixel, with the rectangle cut
 * from the original by Sharp here. The expected rectangles are worked out in
 * this file, not with Vesper's own geometry, so a bug there can't hide.
 */

const site = fileURLToPath(new URL('../apps/playground/', import.meta.url));
const dist = `${site}dist`;

type Rect = { x: number; y: number; w: number; h: number };
type Source = { file: string; width: number; height: number; focus?: { x: number; y: number } };

const harbor: Source = {
  file: 'src/assets/blog/harbor-at-dawn.jpg',
  width: 2400,
  height: 1600,
  focus: { x: 0.62, y: 0.35 },
};
const market: Source = {
  file: 'src/content/blog/2026/winter-market/market.jpg',
  width: 1800,
  height: 1200,
};
/** harbor-at-dawn.md's own square crop. */
const HARBOR_SQUARE: Rect = { x: 0.4, y: 0.1, w: 0.45, h: 0.675 };
const RATIOS: Record<string, number> = { wide: 16 / 9, square: 1, portrait: 4 / 5, og: 1.91 };

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

/** The largest rectangle of `ratio`, centred on the focal point (the centre when none), inside the image. */
function expectedFocalCrop(source: Source, ratio: number): Rect {
  const imageRatio = source.width / source.height;
  const w = imageRatio > ratio ? ratio / imageRatio : 1;
  const h = imageRatio > ratio ? 1 : imageRatio / ratio;
  const focus = source.focus ?? { x: 0.5, y: 0.5 };
  return { x: clamp(focus.x - w / 2, 0, 1 - w), y: clamp(focus.y - h / 2, 0, 1 - h), w, h };
}

/** Mean difference per channel between a served file and the rectangle cut from the original. */
async function differenceFrom(served: Buffer, source: Source, rect: Rect): Promise<number> {
  const out = await sharp(served).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const reference = await sharp(readFileSync(`${site}${source.file}`))
    .extract({
      left: Math.round(rect.x * source.width),
      top: Math.round(rect.y * source.height),
      width: Math.round(rect.w * source.width),
      height: Math.round(rect.h * source.height),
    })
    .resize(out.info.width, out.info.height, { fit: 'fill' })
    .removeAlpha()
    .raw()
    .toBuffer();
  let sum = 0;
  for (let i = 0; i < reference.length; i++)
    sum += Math.abs((out.data[i] ?? 0) - (reference[i] ?? 0));
  return sum / reference.length;
}

/** A served image's bytes, read from the build (the URL is root-relative). */
const served = (url: string) =>
  readFileSync(`${dist}${decodeURI(new URL(url, 'http://x').pathname)}`);

/** `url 480w, url 960w` → [[url, 480], …]. */
const srcsetEntries = (srcset: string) =>
  srcset.split(',').map((part) => {
    const [url = '', descriptor = ''] = part.trim().split(/\s+/);
    return [url, Number.parseInt(descriptor, 10)] as const;
  });

/** Close to the expected crop: well under one level in 255 on average. */
const MATCH = 2;

test.describe('the crop at every declared ratio (/images/)', () => {
  for (const [post, source] of [
    ['harbor-at-dawn', harbor],
    ['2026/winter-market', market],
  ] as const) {
    for (const [name, ratio] of Object.entries(RATIOS)) {
      test(`${post} at ${name}`, async ({ page }) => {
        await page.goto('/images/');
        const img = page.locator(`img[data-post="${post}"][data-ratio="${name}"]`);
        await expect(img).toHaveAttribute('width', '320');
        await expect(img).toHaveAttribute('height', String(Math.round(320 / ratio)));
        const file = served((await img.getAttribute('src')) ?? '');
        const { width, height } = await sharp(file).metadata();
        expect(width).toBe(320);
        expect(height).toBe(Math.round(320 / ratio));
        const manual = post === 'harbor-at-dawn' && name === 'square';
        const expected = manual ? HARBOR_SQUARE : expectedFocalCrop(source, ratio);
        expect(await differenceFrom(file, source, expected)).toBeLessThan(MATCH);
        if (manual) {
          // The manual crop wins for its own ratio, and it's not the focal crop.
          expect(await differenceFrom(file, source, expectedFocalCrop(source, 1))).toBeGreaterThan(
            10,
          );
        }
      });
    }
  }

  test('a fluid image is the whole image, kept in frame by object-position', async ({ page }) => {
    await page.goto('/images/');
    const img = page.locator('img[data-fluid="harbor-at-dawn"]');
    await expect(img).toHaveAttribute('style', 'object-position: 62% 35%');
    const file = served((await img.getAttribute('src')) ?? '');
    expect(await differenceFrom(file, harbor, { x: 0, y: 0, w: 1, h: 1 })).toBeLessThan(MATCH);
    expect(await img.evaluate((el) => getComputedStyle(el).objectPosition)).toBe('62% 35%');
  });

  test('no Vesper option reaches the page as an attribute', async ({ page }) => {
    await page.goto('/images/');
    await expect(page.locator('img[crop], source[crop], img[position]')).toHaveCount(0);
  });
});

/** The post page's hero once the browser has chosen and loaded a source. */
async function loadedHero(page: Page) {
  const img = page.locator('picture img.hero');
  await img.scrollIntoViewIfNeeded();
  await expect
    .poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0))
    .toBe(true);
  return img.evaluate((el: HTMLImageElement) => ({
    currentSrc: new URL(el.currentSrc).pathname,
    ratio: el.naturalWidth / el.naturalHeight,
  }));
}

test.describe('art direction on a post (spec §6.6.5)', () => {
  test('is a valid <picture>: a source per breakpoint, each cropped for its ratio', async ({
    page,
  }) => {
    await page.goto('/blog/harbor-at-dawn/');
    const picture = page.locator('picture:has(img.hero)');
    const children = await picture.evaluate((el) =>
      [...el.children].map((child) => ({
        tag: child.tagName.toLowerCase(),
        media: child.getAttribute('media'),
        type: child.getAttribute('type'),
        srcset: child.getAttribute('srcset') ?? '',
        width: child.getAttribute('width'),
        height: child.getAttribute('height'),
        alt: child.getAttribute('alt'),
      })),
    );
    expect(children.map((child) => [child.tag, child.media, child.type])).toEqual([
      ['source', '(min-width: 48rem)', 'image/webp'],
      ['source', null, 'image/webp'],
      ['img', null, null],
    ]);
    const [wide, square, img] = children;
    expect([wide?.width, wide?.height]).toEqual(['2400', '1350']);
    expect([square?.width, square?.height]).toEqual(['1080', '1080']);
    expect(img?.alt).toBe(
      'Illustration of an orange sun low over a dark harbor, with one small boat heading out',
    );
    for (const [child, rect, ratio] of [
      [wide, expectedFocalCrop(harbor, 16 / 9), 16 / 9],
      [square, HARBOR_SQUARE, 1],
      [img, HARBOR_SQUARE, 1],
    ] as const) {
      const entries = srcsetEntries(child?.srcset ?? '');
      expect(entries.length).toBeGreaterThan(1);
      for (const [url, width] of entries) {
        const file = served(url);
        const meta = await sharp(file).metadata();
        expect(meta.width).toBe(width);
        expect(meta.width / meta.height).toBeCloseTo(ratio, 1);
        expect(await differenceFrom(file, harbor, rect), url).toBeLessThan(MATCH);
      }
    }
  });

  test('a narrow screen gets the square crop', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto('/blog/harbor-at-dawn/');
    const hero = await loadedHero(page);
    expect(hero.ratio).toBeCloseTo(1, 2);
    const squareSrcset = await page.locator('picture source:not([media])').getAttribute('srcset');
    expect(srcsetEntries(squareSrcset ?? '').map(([url]) => url)).toContain(hero.currentSrc);
  });

  test('a wide screen gets the wide crop', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/blog/harbor-at-dawn/');
    const hero = await loadedHero(page);
    expect(hero.ratio).toBeCloseTo(16 / 9, 2);
    const wideSrcset = await page.locator('picture source[media]').getAttribute('srcset');
    expect(srcsetEntries(wideSrcset ?? '').map(([url]) => url)).toContain(hero.currentSrc);
  });

  test('the social image is the og crop', async ({ page }) => {
    await page.goto('/blog/harbor-at-dawn/');
    const url = await page.locator('meta[property="og:image"]').getAttribute('content');
    const file = served(url ?? '');
    expect(await sharp(file).metadata()).toMatchObject({ width: 1200, height: 628 });
    expect(await differenceFrom(file, harbor, expectedFocalCrop(harbor, 1.91))).toBeLessThan(MATCH);
  });

  test('the blog list’s thumbnails use the square crop', async ({ page }) => {
    await page.goto('/blog/');
    const thumb = page.locator('img.thumb[alt^="Illustration of an orange sun"]');
    await expect(thumb).toHaveAttribute('width', '96');
    const file = served((await thumb.getAttribute('src')) ?? '');
    expect(await differenceFrom(file, harbor, HARBOR_SQUARE)).toBeLessThan(MATCH);
  });
});
