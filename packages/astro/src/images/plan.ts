import type { ImageMetadata } from 'astro';
import {
  CENTER,
  cropForRatio,
  focalCrop,
  focusWithin,
  imageValueOf,
  objectPosition,
  pixelRect,
  roundRect,
  sharpAnchor,
  type CropRect,
  type FocalPoint,
} from '@vespercms/core/images';
import { serviceKind, type ServiceKind } from './register.ts';

/*
 * What `<Img>` asks Astro for (spec §6.6.5), worked out without Astro so it
 * can be tested in Node. `<Img>` and `getImg()` hand the result to Astro's
 * own `<Image>`, `<Picture>` and `getImage()`.
 *
 * - With a ratio (a name, a number, or a fixed width and height): the crop
 *   for that ratio. Vesper's crop step cuts it exactly; without the step,
 *   Astro's own server crop cuts the ratio's largest box, at the nearest of
 *   Sharp's anchors when the service is Astro's Sharp.
 * - Without one (fluid layouts): the whole image, no server crop.
 * - Always: the focal point, relative to whatever was cut, as the
 *   `object-position` style, so CSS cropping keeps the subject in frame.
 *   Never as Astro's `position` (DECISIONS.md, "Astro hands `position` to
 *   Sharp unchanged").
 */

/** An image field's value: `fields.image()`'s object, as Astro parses it. */
export type ImageFieldValue = {
  src: ImageMetadata | string;
  alt?: string;
  decorative?: boolean;
  focus?: FocalPoint;
  crops?: Record<string, CropRect>;
};

/** A ratio: one of the site's names (`'wide'`) or width / height as a number. */
export type RatioInput = string | number;

/** Astro's image props, loosely: `<Img>` passes on whatever it doesn't use itself. */
export type ImageProps = {
  width?: number | `${number}`;
  height?: number | `${number}`;
  widths?: number[];
  densities?: (number | `${number}x`)[];
  sizes?: string;
  layout?: 'constrained' | 'fixed' | 'full-width' | 'none';
  fit?: string;
  position?: string;
  style?: string | Record<string, string | number | undefined>;
  [attribute: string]: unknown;
};

/** One image, cropped to a ratio or fluid: `getImg()`'s props. */
export type CroppedImageProps = ImageProps & {
  /** The image field's value, such as `post.data.hero`. */
  image: ImageFieldValue;
  /** Crop to this ratio: a name from `images.ratios` in vesper.config.ts, or a number. */
  ratio?: RatioInput;
};

export type ImgProps = CroppedImageProps & {
  /**
   * Art direction: a ratio per media query, plus `base` for everything else,
   * as in `{ base: 'square', '(min-width: 48rem)': 'wide' }`. Renders a
   * `<picture>` with one `<source>` per query, each with its own crop.
   */
  art?: Record<string, RatioInput>;
  /** Formats for `<source>` elements, as in Astro's `<Picture>`. */
  formats?: string[];
  fallbackFormat?: string;
  pictureAttributes?: Record<string, unknown>;
};

/** What `<Img>` knows about the site: its ratios, and which image service renders this page. */
export type ImageContext = {
  ratios: Record<string, number>;
  service: ServiceKind;
  /** Astro's `image.breakpoints`, or its own defaults for this kind of service. */
  breakpoints: readonly number[];
  /** Astro's `image.layout`, the default for images that don't set one. */
  layout?: string;
};

/** Astro's default breakpoints for a service that transforms images itself (Astro's `LIMITED_RESOLUTIONS`). */
const LOCAL_BREAKPOINTS = [640, 750, 828, 1080, 1280, 1668, 2048, 2560];
/** And for any other service (Astro's `DEFAULT_RESOLUTIONS`). */
const OTHER_BREAKPOINTS = [
  640, 750, 828, 960, 1080, 1280, 1668, 1920, 2048, 2560, 3200, 3840, 4480, 5120, 6016,
];

/** The context from `astro:assets`' `imageConfig` and the site's ratios. */
export function imageContext(
  imageConfig: { service?: unknown; breakpoints?: number[]; layout?: string },
  ratios: Record<string, number>,
): ImageContext {
  const entrypoint = (imageConfig.service as { entrypoint?: unknown } | undefined)?.entrypoint;
  const service = serviceKind(entrypoint);
  return {
    ratios,
    service,
    breakpoints: imageConfig.breakpoints?.length
      ? imageConfig.breakpoints
      : service === 'other'
        ? OTHER_BREAKPOINTS
        : LOCAL_BREAKPOINTS,
    ...(imageConfig.layout ? { layout: imageConfig.layout } : {}),
  };
}

const isMetadata = (src: unknown): src is ImageMetadata =>
  typeof src === 'object' &&
  src !== null &&
  typeof (src as ImageMetadata).width === 'number' &&
  typeof (src as ImageMetadata).height === 'number';

const toNumber = (n: number | string | undefined) =>
  n === undefined ? undefined : typeof n === 'number' ? n : Number.parseInt(n, 10);

function ratioOf(
  input: RatioInput,
  ctx: ImageContext,
  where: string,
): { name?: string; ratio: number } {
  if (typeof input === 'number') {
    if (Number.isFinite(input) && input > 0) return { ratio: input };
    throw new Error(
      `${where}: a ratio must be a number above zero, width / height, not ${String(input)}.`,
    );
  }
  const ratio = ctx.ratios[input];
  if (ratio === undefined) {
    throw new Error(
      `${where}: the site has no ratio named "${input}". vesper.config.ts declares ${Object.keys(ctx.ratios).join(', ')}.`,
    );
  }
  return { name: input, ratio };
}

/** Adds `object-position` to a style, which the site's own style still overrides. */
function withObjectPosition(style: ImageProps['style'], position: string): ImageProps['style'] {
  if (style === undefined) return `object-position: ${position}`;
  if (typeof style === 'string') return `object-position: ${position}; ${style}`;
  return { objectPosition: position, ...style };
}

/**
 * Widths for `srcset`, as Astro works them out (its `getWidths`), but no
 * wider than the crop: Astro stops at the original's width, which is wider
 * than any crop, and an image is never enlarged.
 */
function widthsFor(
  layout: string,
  width: number,
  cropWidth: number,
  breakpoints: readonly number[],
): number[] {
  const within = (w: number) => w <= cropWidth;
  if (layout === 'full-width') {
    const list = breakpoints.filter(within);
    return list.length > 0 ? list : [cropWidth];
  }
  const max = Math.min(width * 2, cropWidth);
  if (layout === 'fixed') return width > cropWidth ? [cropWidth] : [...new Set([width, max])];
  if (layout === 'constrained') {
    return [...new Set([width, width * 2, ...breakpoints])]
      .filter((w) => w <= max)
      .sort((a, b) => a - b);
  }
  return [];
}

/** Given widths, capped at the crop's own, with the crop's width added if any were dropped (as Astro does). */
function capWidths(widths: number[], cropWidth: number): number[] {
  const kept = widths.filter((w) => w <= cropWidth);
  if (kept.length < widths.length) kept.push(cropWidth);
  return [...new Set(kept)].sort((a, b) => a - b);
}

/** The options for one image at one ratio (or none), ready for Astro. */
function planOne(
  image: ImageFieldValue,
  ratioInput: RatioInput | undefined,
  rest: ImageProps,
  ctx: ImageContext,
  where: string,
): Record<string, unknown> {
  const { src } = image;
  const value = imageValueOf(image);
  const alt = image.decorative === true ? '' : (image.alt ?? '');
  const width = toNumber(rest.width);
  const height = toNumber(rest.height);

  // A remote image or a plain path: Astro can't crop what it can't measure here.
  if (!isMetadata(src)) {
    return {
      ...rest,
      src,
      alt,
      ...(value.focus
        ? { style: withObjectPosition(rest.style, objectPosition(value.focus)) }
        : {}),
    };
  }

  const size = { width: src.width, height: src.height };
  const chosen =
    ratioInput !== undefined
      ? ratioOf(ratioInput, ctx, where)
      : width && height
        ? { ratio: width / height }
        : undefined;

  if (!chosen) {
    // Fluid: no server crop, the focal point keeps the subject in frame.
    return {
      ...rest,
      src,
      alt,
      ...(value.focus
        ? { style: withObjectPosition(rest.style, objectPosition(value.focus)) }
        : {}),
    };
  }

  const { rect } = cropForRatio(value, chosen.name, chosen.ratio, size);
  const cropWidth = pixelRect(rect, size).width;
  const outWidth = width ?? (height ? Math.round(height * chosen.ratio) : cropWidth);
  const outHeight = Math.round(outWidth / chosen.ratio);
  const layout = rest.layout ?? ctx.layout ?? 'none';
  const widths = rest.widths
    ? capWidths(rest.widths, cropWidth)
    : layout !== 'none' && !rest.densities
      ? widthsFor(layout, outWidth, cropWidth, ctx.breakpoints)
      : undefined;

  let cut: CropRect;
  let service: Record<string, unknown>;
  if (ctx.service === 'vesper') {
    cut = rect;
    service = { crop: roundRect(rect), fit: rest.fit ?? 'cover' };
  } else if (ctx.service === 'sharp') {
    const anchor = sharpAnchor(rect, chosen.ratio, size);
    cut = anchor.rect;
    service = { position: rest.position ?? anchor.position, fit: rest.fit ?? 'cover' };
  } else {
    // A host's service crops the ratio's box from the centre, as far as Vesper knows.
    cut = focalCrop(size, chosen.ratio, CENTER);
    service = { fit: rest.fit ?? 'cover' };
  }

  return {
    ...rest,
    src,
    alt,
    width: outWidth,
    height: outHeight,
    ...(widths && widths.length > 0 ? { widths } : {}),
    ...service,
    ...(value.focus
      ? { style: withObjectPosition(rest.style, objectPosition(focusWithin(cut, value.focus))) }
      : {}),
  };
}

function imageOf(props: { image?: unknown }, where: string): ImageFieldValue {
  const { image } = props;
  if (typeof image !== 'object' || image === null || !('src' in image)) {
    throw new Error(
      `${where} needs an image: pass the image field's value, such as post.data.hero.`,
    );
  }
  return image as ImageFieldValue;
}

/** Props for Astro's `<Image>` or `<Picture>`, or for `getImage()`: one image, at one ratio or fluid. */
export function planImg(
  props: ImgProps | CroppedImageProps,
  ctx: ImageContext,
): Record<string, unknown> {
  const image = imageOf(props, '<Img>');
  const {
    image: _image,
    ratio,
    art: _art,
    formats: _formats,
    fallbackFormat: _fallback,
    pictureAttributes: _picture,
    ...rest
  } = props;
  return planOne(image, ratio, rest, ctx, '<Img>');
}

export type ArtPlan = {
  /** One per media query, in the order given: the options for `getImage()`, without a format. */
  sources: { media: string; options: Record<string, unknown> }[];
  /** The `base` ratio: its `<source>` elements without `media`, and the `<img>`. */
  base: Record<string, unknown>;
  formats: string[];
  fallbackFormat: string;
};

/** Formats Astro's `<Picture>` keeps as the fallback rather than turning into PNG. */
const KEEP_FORMAT = ['gif', 'svg', 'jpg', 'jpeg'];

/** Art direction: per-breakpoint crops for a `<picture>` (spec §6.6.5). */
export function planArt(props: ImgProps, ctx: ImageContext): ArtPlan {
  const image = imageOf(props, '<Img art>');
  const {
    image: _image,
    ratio: _ratio,
    art,
    formats,
    fallbackFormat,
    pictureAttributes: _picture,
    ...rest
  } = props;
  if (!art || art.base === undefined) {
    throw new Error(
      "<Img art> needs a base ratio for screens no query matches, as in art={{ base: 'square', '(min-width: 48rem)': 'wide' }}.",
    );
  }
  const where = (media: string) => `<Img art> (${media})`;
  const sources = Object.entries(art)
    .filter(([media]) => media !== 'base')
    .map(([media, ratio]) => ({ media, options: planOne(image, ratio, rest, ctx, where(media)) }));
  const srcFormat = isMetadata(image.src) ? image.src.format : undefined;
  return {
    sources,
    base: planOne(image, art.base, rest, ctx, where('base')),
    formats: formats ?? ['webp'],
    fallbackFormat:
      fallbackFormat ?? (srcFormat && KEEP_FORMAT.includes(srcFormat) ? srcFormat : 'png'),
  };
}

/** A `<source type>` for an output format. */
export function mimeType(format: string): string {
  if (format === 'jpg' || format === 'jpeg') return 'image/jpeg';
  if (format === 'svg') return 'image/svg+xml';
  return `image/${format}`;
}
