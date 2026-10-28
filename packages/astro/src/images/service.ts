import type { LocalImageService } from 'astro';
import { baseService } from 'astro/assets';
import sharpService from 'astro/assets/services/sharp';
import { isCropRect, pixelRect, type CropRect } from '@vespercms/core/images';
import type { Sharp, SharpOptions } from 'sharp';

/*
 * The crop step (spec §6.6.5): Astro's own Sharp image service with one more
 * transform option, `crop`, a normalized rectangle. The rectangle is cut out
 * of the upright image first, then Astro's transform resizes and encodes it
 * as usual, so formats, `srcset` and caching don't change. Images without a
 * crop go straight to Astro's transform.
 *
 * Astro hashes only the properties a service names, and passes unknown ones
 * on to the page as attributes (DECISIONS.md, "Astro hands `position` to
 * Sharp unchanged"), so `crop` is added to the hash, to `/_image` URLs for
 * dev, and kept out of the HTML.
 */

type Transform = Parameters<LocalImageService['transform']>[1];
type ImageOptions = Parameters<NonNullable<LocalImageService['validateOptions']>>[0];
type Config = Parameters<LocalImageService['transform']>[2];

/** The `/_image` query parameter: `crop=x,y,w,h`. */
const PARAM = 'crop';

/** `x,y,w,h`, the form `crop` takes in a URL. */
export function formatCrop(rect: CropRect): string {
  return [rect.x, rect.y, rect.w, rect.h].map(String).join(',');
}

/** A `crop` parameter read back, or undefined when it isn't a rectangle inside the image. */
export function parseCrop(text: string | null): CropRect | undefined {
  if (text === null) return undefined;
  const [x, y, w, h] = text.split(',').map(Number);
  const rect = { x, y, w, h };
  return isCropRect(rect) ? rect : undefined;
}

const formatOf = (src: unknown) =>
  typeof src === 'object' && src !== null && 'format' in src ? String(src.format) : undefined;

const describe = (src: unknown) =>
  typeof src === 'string'
    ? src
    : typeof src === 'object' && src !== null && 'src' in src
      ? String(src.src)
      : 'an image';

type SharpModule = (input: Uint8Array, options?: SharpOptions) => Sharp;
let loaded: SharpModule | undefined;

async function loadSharp(): Promise<SharpModule> {
  if (loaded) return loaded;
  try {
    const module = (await import('sharp')).default;
    // As Astro does: libvips' cache races when small files are processed quickly.
    module.cache(false);
    loaded = module;
    return module;
  } catch {
    throw new Error(
      'Vesper’s crop step needs sharp, which Astro’s own image service uses too. Install it with `npm install sharp`, or turn the crop step off with vesper({ imageService: false }).',
    );
  }
}

/**
 * The rectangle cut out of the upright image, as a lossless PNG for Astro's
 * transform to resize and encode. Null for images it can't cut: animated
 * images and SVG pass through uncropped, as Astro passes them through.
 */
export async function extractCrop(
  input: Uint8Array,
  crop: CropRect,
  config: { limitInputPixels?: SharpOptions['limitInputPixels'] } = {},
): Promise<Uint8Array | null> {
  const sharp = await loadSharp();
  const options: SharpOptions = {
    failOn: 'none',
    ...(config.limitInputPixels === undefined ? {} : { limitInputPixels: config.limitInputPixels }),
  };
  const meta = await sharp(input, options).metadata();
  if (!meta.width || !meta.height || meta.format === 'svg' || (meta.pages ?? 1) > 1) return null;
  // Orientations 5 to 8 turn the picture a quarter, so the upright image is the other way round.
  const turned = (meta.orientation ?? 1) >= 5;
  const upright = turned
    ? { width: meta.height, height: meta.width }
    : { width: meta.width, height: meta.height };
  // rotate() first: crops are measured on the image as browsers show it.
  const data = await sharp(input, options)
    .rotate()
    .extract(pixelRect(crop, upright))
    .png({ compressionLevel: 0 })
    .toBuffer();
  return new Uint8Array(data);
}

const cropOf = (options: object): CropRect | undefined => {
  const { crop } = options as { crop?: unknown };
  return isCropRect(crop) ? crop : undefined;
};

const vesperService: LocalImageService = {
  ...sharpService,
  propertiesToHash: [...(baseService.propertiesToHash ?? []), 'crop'],

  validateOptions(options: ImageOptions, config, logger) {
    const record = options as ImageOptions & { crop?: unknown };
    if (record.crop !== undefined) {
      if (!isCropRect(record.crop)) {
        throw new Error(
          `The crop for ${describe(options.src)} must be a rectangle inside the image, { x, y, w, h } from 0 to 1. It was ${JSON.stringify(record.crop)}.`,
        );
      }
      const format = formatOf(options.src);
      if (format === 'svg' || format === 'gif') {
        // Passed through or animated by Astro, never cropped.
        delete record.crop;
      } else {
        // Only the four numbers, so the hash can't depend on anything else.
        const { x, y, w, h } = record.crop;
        record.crop = { x, y, w, h };
      }
    }
    return sharpService.validateOptions
      ? sharpService.validateOptions(options, config, logger)
      : options;
  },

  async getURL(options, config, logger) {
    const url = await sharpService.getURL(options, config, logger);
    const crop = cropOf(options);
    // An image Astro doesn't process keeps its own URL.
    if (!crop || url === options.src) return url;
    return `${url}${url.includes('?') ? '&' : '?'}${PARAM}=${encodeURIComponent(formatCrop(crop))}`;
  },

  parseURL(url, config, logger) {
    const crop = parseCrop(url.searchParams.get(PARAM));
    const parsed = sharpService.parseURL(url, config, logger);
    if (!crop) return parsed;
    // Astro's own parseURL is synchronous, but a service may return a promise.
    return Promise.resolve(parsed).then((transform) =>
      transform ? { ...transform, crop } : undefined,
    ) as ReturnType<LocalImageService['parseURL']>;
  },

  getHTMLAttributes(options, config, logger) {
    const { crop: _crop, ...rest } = options as typeof options & { crop?: unknown };
    return sharpService.getHTMLAttributes
      ? sharpService.getHTMLAttributes(rest, config, logger)
      : rest;
  },

  async transform(input: Uint8Array, transform: Transform, config: Config, logger) {
    const { crop: _crop, ...rest } = transform;
    const crop = cropOf(transform);
    if (!crop) return sharpService.transform(input, rest, config, logger);
    const settings = config.service.config as {
      limitInputPixels?: SharpOptions['limitInputPixels'];
    };
    const cropped = await extractCrop(input, crop, settings);
    return sharpService.transform(cropped ?? input, rest, config, logger);
  },
};

export default vesperService;
