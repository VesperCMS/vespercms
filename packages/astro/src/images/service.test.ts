import { readFileSync } from 'node:fs';
import type { ImageMetadata, LocalImageService } from 'astro';
import { baseService, hashTransform } from 'astro/assets';
import sharpService from 'astro/assets/services/sharp';
import { pixelRect } from '@vespercms/core/images';
import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';
import vesperService, { extractCrop, formatCrop, parseCrop } from './service.ts';

/*
 * The crop step around Astro's Sharp service (spec §6.6.5), with the real
 * Sharp: crops are cut from the upright image, then Astro's own transform
 * does the rest.
 */

const playground = new URL('../../../../apps/playground/', import.meta.url);
const harbor = new Uint8Array(
  readFileSync(new URL('src/assets/blog/harbor-at-dawn.jpg', playground)),
);
const rotated = new Uint8Array(
  readFileSync(new URL('fixtures/uploads/portrait-exif-6.jpg', playground)),
);

type Config = Parameters<LocalImageService['transform']>[2];
const config = {
  endpoint: { route: '/_image' },
  service: { entrypoint: 'vespercms/image-service', config: {} },
  domains: [],
  remotePatterns: [],
} as unknown as Config;
const logger = { info() {}, warn() {}, error() {}, debug() {} } as unknown as Parameters<
  LocalImageService['transform']
>[3];

const metadata = (format: string): ImageMetadata =>
  ({
    src: `/src/assets/harbor.${format}`,
    width: 2400,
    height: 1600,
    format,
  }) as ImageMetadata;

const square = { x: 0.4, y: 0.1, w: 0.45, h: 0.675 };

/** Mean difference per channel between two decoded images of the same size. */
async function difference(a: Uint8Array, b: Uint8Array): Promise<number> {
  const [left, right] = await Promise.all(
    [a, b].map((data) => sharp(data).removeAlpha().raw().toBuffer({ resolveWithObject: true })),
  );
  if (!left || !right) throw new Error('decode failed');
  expect([left.info.width, left.info.height]).toEqual([right.info.width, right.info.height]);
  let sum = 0;
  for (let i = 0; i < left.data.length; i++)
    sum += Math.abs((left.data[i] ?? 0) - (right.data[i] ?? 0));
  return sum / left.data.length;
}

describe('the crop step: options, hashing and URLs', () => {
  it('hashes crops, so each crop of an image gets its own file', () => {
    expect(vesperService.propertiesToHash).toEqual([
      ...(baseService.propertiesToHash ?? []),
      'crop',
    ]);
    const props = vesperService.propertiesToHash ?? [];
    const base = { src: metadata('jpg'), width: 300, height: 300, format: 'webp' };
    const a = hashTransform({ ...base, crop: square }, 'vesper', props);
    const b = hashTransform({ ...base, crop: { ...square, x: 0.1 } }, 'vesper', props);
    expect(a).not.toBe(b);
  });

  it('checks the crop and keeps only its four numbers', async () => {
    const options = await vesperService.validateOptions?.(
      { src: metadata('jpg'), width: 300, crop: { ...square, extra: true } },
      config,
      logger,
    );
    expect(options).toMatchObject({ crop: square, format: 'webp' });
    expect(options?.crop).toEqual(square);
    await expect(async () =>
      vesperService.validateOptions?.(
        { src: metadata('jpg'), crop: { x: 0.8, y: 0, w: 0.5, h: 0.5 } },
        config,
        logger,
      ),
    ).rejects.toThrow(
      'The crop for /src/assets/harbor.jpg must be a rectangle inside the image, { x, y, w, h } from 0 to 1.',
    );
  });

  it('never crops SVG or GIF, which Astro passes through or animates', async () => {
    for (const format of ['svg', 'gif']) {
      const options = await vesperService.validateOptions?.(
        { src: metadata(format), crop: square },
        config,
        logger,
      );
      expect(options).not.toHaveProperty('crop');
    }
  });

  it('carries the crop on /_image URLs in dev, and reads it back', async () => {
    // Astro's own getURL reads import.meta.env, which only a Vite build has: its URL stands in.
    const astroUrl = '/_image?href=%2Fsrc%2Fassets%2Fharbor.jpg&w=300&h=300&f=webp';
    const getURL = vi.spyOn(sharpService, 'getURL').mockReturnValue(astroUrl);
    try {
      const url = await vesperService.getURL(
        { src: metadata('jpg'), width: 300, height: 300, format: 'webp', crop: square },
        config,
        logger,
      );
      expect(url).toBe(`${astroUrl}&crop=${encodeURIComponent('0.4,0.1,0.45,0.675')}`);
      const parsed = await vesperService.parseURL(new URL(url, 'http://localhost'), config, logger);
      expect(parsed).toMatchObject({ src: '/src/assets/harbor.jpg', width: 300, crop: square });
      expect(await vesperService.getURL({ src: metadata('jpg'), width: 300 }, config, logger)).toBe(
        astroUrl,
      );
      // An image Astro won't process keeps its own address, with nothing added.
      getURL.mockReturnValue('https://elsewhere.example/a.jpg');
      expect(
        await vesperService.getURL(
          { src: 'https://elsewhere.example/a.jpg', crop: square },
          config,
          logger,
        ),
      ).toBe('https://elsewhere.example/a.jpg');
    } finally {
      getURL.mockRestore();
    }
  });

  it('ignores a crop parameter that isn’t a rectangle inside the image', () => {
    expect(formatCrop(square)).toBe('0.4,0.1,0.45,0.675');
    expect(parseCrop('0.4,0.1,0.45,0.675')).toEqual(square);
    expect(parseCrop('0.8,0,0.5,0.5')).toBeUndefined();
    expect(parseCrop('a,b,c,d')).toBeUndefined();
    expect(parseCrop(null)).toBeUndefined();
  });

  it('keeps the crop out of the page’s HTML', async () => {
    const attributes = await vesperService.getHTMLAttributes?.(
      { src: metadata('jpg'), width: 300, height: 300, crop: square, alt: 'Boats' },
      config,
      logger,
    );
    expect(attributes).not.toHaveProperty('crop');
    expect(attributes).toMatchObject({ alt: 'Boats', width: 300, height: 300 });
  });
});

describe('the crop step: pixels', () => {
  it('cuts the rectangle, then lets Astro resize and encode it', { timeout: 30_000 }, async () => {
    const { data, format } = await vesperService.transform(
      harbor,
      { src: '/harbor.jpg', width: 300, height: 300, format: 'png', crop: square },
      config,
      logger,
    );
    expect(format).toBe('png');
    const expected = await sharp(harbor)
      .extract(pixelRect(square, { width: 2400, height: 1600 }))
      .resize(300, 300)
      .png()
      .toBuffer();
    expect(await difference(data, expected)).toBeLessThan(1);
    // And it isn't simply Astro's own centred crop.
    const centred = await sharp(harbor).resize(300, 300).png().toBuffer();
    expect(await difference(data, centred)).toBeGreaterThan(5);
  });

  it('leaves images without a crop to Astro’s transform, byte for byte', async () => {
    const transform = { src: '/harbor.jpg', width: 300, height: 200, format: 'webp' };
    const ours = await vesperService.transform(harbor, transform, config, logger);
    const astros = await sharpService.transform(harbor, transform, config, logger);
    expect(Buffer.from(ours.data).equals(Buffer.from(astros.data))).toBe(true);
  });

  it('measures crops on the upright image, as browsers show an EXIF-rotated photo', async () => {
    // Stored 1600×1200 with orientation 6: upright it's a 1200×1600 portrait, "TOP" at the top.
    const top = await extractCrop(rotated, { x: 0, y: 0, w: 1, h: 0.5 });
    if (!top) throw new Error('no crop');
    expect(await sharp(top).metadata()).toMatchObject({ width: 1200, height: 800 });
    const upright = await sharp(rotated).rotate().png().toBuffer();
    const expected = await sharp(upright)
      .extract({ left: 0, top: 0, width: 1200, height: 800 })
      .png()
      .toBuffer();
    expect(await difference(top, expected)).toBe(0);
  });

  it('passes SVG through uncropped', async () => {
    const svg = new TextEncoder().encode(
      '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>',
    );
    expect(await extractCrop(svg, square)).toBeNull();
  });
});
