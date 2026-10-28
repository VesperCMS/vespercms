import type { ImageMetadata } from 'astro';
import {
  focalCrop,
  focusWithin,
  objectPosition,
  roundRect,
  sharpAnchor,
} from '@vespercms/core/images';
import { describe, expect, it } from 'vitest';
import { imageContext, mimeType, planArt, planImg, type ImageContext } from './plan.ts';
import { SHARP_IMAGE_SERVICE, VESPER_IMAGE_SERVICE } from './register.ts';

/*
 * What <Img> asks Astro for, in each mode (spec §6.6.5). The rendering
 * itself is Astro's; the built playground is checked pixel by pixel in the
 * static e2e suite.
 */

const harborSrc = {
  src: '/_astro/harbor-at-dawn.jpg',
  width: 2400,
  height: 1600,
  format: 'jpg',
} as ImageMetadata;
const size = { width: 2400, height: 1600 };
const square = { x: 0.4, y: 0.1, w: 0.45, h: 0.675 };
const focus = { x: 0.62, y: 0.35 };
const hero = { src: harborSrc, alt: 'Boats leaving the harbor', focus, crops: { square } };
const ratios = { wide: 16 / 9, square: 1, portrait: 4 / 5, og: 1.91 };

const ctx = (
  service: ImageContext['service'],
  extra: Partial<ImageContext> = {},
): ImageContext => ({
  ratios,
  service,
  breakpoints: [640, 750, 828, 1080, 1280, 1668, 2048, 2560],
  ...extra,
});

describe('<Img ratio> with Vesper’s crop step', () => {
  it('asks for the focal crop at the ratio’s exact size', () => {
    const wide = focalCrop(size, 16 / 9, focus);
    expect(planImg({ image: hero, ratio: 'wide' }, ctx('vesper'))).toEqual({
      src: harborSrc,
      alt: 'Boats leaving the harbor',
      width: 2400,
      height: 1350,
      crop: roundRect(wide),
      fit: 'cover',
      style: `object-position: ${objectPosition(focusWithin(wide, focus))}`,
    });
  });

  it('uses the manual crop for its own ratio only', () => {
    const plan = planImg({ image: hero, ratio: 'square' }, ctx('vesper'));
    expect(plan).toMatchObject({ crop: square, width: 1080, height: 1080 });
    const portrait = planImg({ image: hero, ratio: 'portrait' }, ctx('vesper'));
    expect(portrait.crop).toEqual(roundRect(focalCrop(size, 4 / 5, focus)));
    // A ratio given as a number has no name, so no manual crop.
    expect(planImg({ image: hero, ratio: 1 }, ctx('vesper')).crop).toEqual(
      roundRect(focalCrop(size, 1, focus)),
    );
  });

  it('works out the height from the width, or the width from the height', () => {
    expect(planImg({ image: hero, ratio: 'wide', width: 960 }, ctx('vesper'))).toMatchObject({
      width: 960,
      height: 540,
    });
    expect(planImg({ image: hero, ratio: 'square', height: '300' }, ctx('vesper'))).toMatchObject({
      width: 300,
      height: 300,
    });
  });

  it('treats a fixed width and height as a ratio of their own', () => {
    const plan = planImg({ image: hero, width: 400, height: 300 }, ctx('vesper'));
    expect(plan).toMatchObject({ width: 400, height: 300 });
    expect(plan.crop).toEqual(roundRect(focalCrop(size, 4 / 3, focus)));
  });

  it('never lists a width wider than the crop', () => {
    expect(
      planImg({ image: hero, ratio: 'square', widths: [480, 960, 1440] }, ctx('vesper')).widths,
    ).toEqual([480, 960, 1080]);
    expect(
      planImg({ image: hero, ratio: 'square', layout: 'full-width' }, ctx('vesper')).widths,
    ).toEqual([640, 750, 828, 1080]);
    expect(
      planImg({ image: hero, ratio: 'square', layout: 'constrained', width: 600 }, ctx('vesper'))
        .widths,
    ).toEqual([600, 640, 750, 828, 1080]);
    expect(
      planImg({ image: hero, ratio: 'square', layout: 'fixed', width: 600 }, ctx('vesper')).widths,
    ).toEqual([600, 1080]);
    // Astro's own default layout counts too.
    expect(
      planImg({ image: hero, ratio: 'wide' }, ctx('vesper', { layout: 'full-width' })).widths,
    ).toEqual([640, 750, 828, 1080, 1280, 1668, 2048]);
  });

  it('passes every other prop on, and the site’s own style wins', () => {
    const plan = planImg(
      { image: hero, ratio: 'wide', class: 'hero', loading: 'eager', style: 'border: 0' },
      ctx('vesper'),
    );
    expect(plan).toMatchObject({ class: 'hero', loading: 'eager' });
    expect(plan.style).toMatch(/^object-position: [\d.]+% [\d.]+%; border: 0$/);
    const objectStyle = planImg(
      { image: hero, ratio: 'wide', style: { objectPosition: 'top' } },
      ctx('vesper'),
    );
    expect(objectStyle.style).toEqual({ objectPosition: 'top' });
  });

  it('renders alt="" for a decorative image', () => {
    expect(
      planImg({ image: { ...hero, alt: '', decorative: true }, ratio: 'wide' }, ctx('vesper')).alt,
    ).toBe('');
  });
});

describe('<Img ratio> without the crop step', () => {
  it('lets Astro’s Sharp service crop the ratio at the nearest anchor', () => {
    const plan = planImg({ image: hero, ratio: 'square' }, ctx('sharp'));
    const anchor = sharpAnchor(square, 1, size);
    expect(plan).toMatchObject({ width: 1080, height: 1080, fit: 'cover', position: 'right' });
    expect(plan).not.toHaveProperty('crop');
    expect(anchor.position).toBe('right');
    expect(plan.style).toBe(`object-position: ${objectPosition(focusWithin(anchor.rect, focus))}`);
  });

  it('sends a host’s service nothing but the size, and keeps the focal point in CSS', () => {
    const plan = planImg({ image: hero, ratio: 'wide' }, ctx('other'));
    expect(plan).toMatchObject({ width: 2400, height: 1350, fit: 'cover' });
    expect(plan).not.toHaveProperty('crop');
    expect(plan).not.toHaveProperty('position');
    expect(plan.style).toBe(
      `object-position: ${objectPosition(focusWithin(focalCrop(size, 16 / 9), focus))}`,
    );
  });
});

describe('<Img> without a ratio (fluid)', () => {
  it('has no server crop: the focal point becomes object-position', () => {
    expect(planImg({ image: hero, layout: 'full-width' }, ctx('vesper'))).toEqual({
      src: harborSrc,
      alt: 'Boats leaving the harbor',
      layout: 'full-width',
      style: 'object-position: 62% 35%',
    });
    expect(planImg({ image: { src: harborSrc, alt: 'x' } }, ctx('vesper'))).not.toHaveProperty(
      'style',
    );
  });

  it('passes a remote image through, focal point and all', () => {
    expect(
      planImg(
        {
          image: { src: 'https://media.example/a.jpg', alt: 'A', focus },
          ratio: 'wide',
          width: 800,
        },
        ctx('vesper'),
      ),
    ).toEqual({
      src: 'https://media.example/a.jpg',
      alt: 'A',
      width: 800,
      style: 'object-position: 62% 35%',
    });
  });
});

describe('mistakes', () => {
  it('names the ratios the site declares when a name is wrong', () => {
    expect(() => planImg({ image: hero, ratio: 'wdie' }, ctx('vesper'))).toThrow(
      '<Img>: the site has no ratio named "wdie". vesper.config.ts declares wide, square, portrait, og.',
    );
    expect(() => planImg({ image: hero, ratio: 0 }, ctx('vesper'))).toThrow(/above zero/);
  });

  it('asks for the field’s value when there’s no image', () => {
    expect(() => planImg({ image: undefined as never }, ctx('vesper'))).toThrow(
      "<Img> needs an image: pass the image field's value, such as post.data.hero.",
    );
  });
});

describe('<Img art> (art direction)', () => {
  it('plans one crop per media query, in order, plus the base', () => {
    const plan = planArt(
      {
        image: hero,
        art: { base: 'square', '(min-width: 48rem)': 'wide', '(min-width: 80rem)': 'og' },
        widths: [480, 960],
        sizes: '100vw',
      },
      ctx('vesper'),
    );
    expect(plan.sources.map((source) => [source.media, source.options.crop])).toEqual([
      ['(min-width: 48rem)', roundRect(focalCrop(size, 16 / 9, focus))],
      ['(min-width: 80rem)', roundRect(focalCrop(size, 1.91, focus))],
    ]);
    expect(plan.base).toMatchObject({ crop: square, widths: [480, 960], sizes: '100vw' });
    expect(plan.formats).toEqual(['webp']);
    // Like Astro's <Picture>: a JPEG stays a JPEG for browsers without WebP.
    expect(plan.fallbackFormat).toBe('jpg');
  });

  it('needs a base ratio', () => {
    expect(() =>
      planArt({ image: hero, art: { '(min-width: 48rem)': 'wide' } }, ctx('vesper')),
    ).toThrow(/needs a base ratio/);
    expect(() => planArt({ image: hero, art: { base: 'nope' } }, ctx('vesper'))).toThrow(
      '<Img art> (base): the site has no ratio named "nope".',
    );
  });

  it('respects the formats asked for', () => {
    const plan = planArt(
      { image: hero, art: { base: 'square' }, formats: ['avif', 'webp'], fallbackFormat: 'png' },
      ctx('vesper'),
    );
    expect(plan).toMatchObject({ formats: ['avif', 'webp'], fallbackFormat: 'png' });
  });
});

describe('imageContext', () => {
  it('reads the service and breakpoints from astro:assets’ imageConfig', () => {
    expect(imageContext({ service: { entrypoint: VESPER_IMAGE_SERVICE } }, ratios)).toMatchObject({
      service: 'vesper',
      breakpoints: [640, 750, 828, 1080, 1280, 1668, 2048, 2560],
    });
    expect(imageContext({ service: { entrypoint: SHARP_IMAGE_SERVICE } }, ratios).service).toBe(
      'sharp',
    );
    const host = imageContext({ service: { entrypoint: '@astrojs/vercel/image' } }, ratios);
    expect(host.service).toBe('other');
    expect(host.breakpoints).toContain(6016);
    expect(
      imageContext({ service: {}, breakpoints: [400, 800], layout: 'constrained' }, ratios),
    ).toMatchObject({ breakpoints: [400, 800], layout: 'constrained' });
  });

  it('names source types', () => {
    expect(mimeType('jpg')).toBe('image/jpeg');
    expect(mimeType('webp')).toBe('image/webp');
    expect(mimeType('svg')).toBe('image/svg+xml');
  });
});
