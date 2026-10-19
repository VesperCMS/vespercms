import { z } from 'astro/zod';

/*
 * Field helpers (spec §6.3.2). Each one returns plain Zod with `.meta()`
 * attached: Astro validates it like any other schema, and the content file
 * holds a plain value. A site can drop the import and paste the Zod shown
 * next to each helper to get identical behavior.
 *
 * Everything comes from `astro/zod`, the copy Astro validates with, so the
 * meta hints are visible to Vesper (spec §6.3).
 */

/**
 * A hex colour, `"#1a73e8"` (8 digits with `alpha`).
 *
 * Raw equivalent: `z.string().regex(/^#[0-9a-f]{6}$/i).meta({ widget: 'color' })`.
 *
 * @param options.palette Named swatches, `{ Indigo: '#28335f' }`. The editor
 *   then shows a radio group of names instead of a full picker.
 * @param options.contrast What the colour is used for, so the studio can check
 *   it against the site's `a11y.backgrounds` (spec §6.18): `'text'` needs
 *   4.5:1, `'large-text'` and `'graphic'` 3:1. Without it, no check.
 */
export function color(
  options: {
    palette?: Record<string, string>;
    alpha?: boolean;
    contrast?: 'text' | 'large-text' | 'graphic';
  } = {},
) {
  const pattern = options.alpha ? /^#[0-9a-f]{8}$/i : /^#[0-9a-f]{6}$/i;
  return z
    .string()
    .regex(pattern)
    .meta(
      withOptions('color', {
        palette: options.palette,
        alpha: options.alpha,
        contrast: options.contrast,
      }),
    );
}

/**
 * A map position, `{ lat: 36.69, lng: -81.97 }`. The lat/lng number fields are
 * the real controls; the map is an enhancement.
 *
 * Raw equivalent: `z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }).meta({ widget: 'geo' })`.
 */
export function geo(options: { defaultCenter?: { lat: number; lng: number }; zoom?: number } = {}) {
  return z
    .object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) })
    .meta(withOptions('geo', { defaultCenter: options.defaultCenter, zoom: options.zoom }));
}

/**
 * A URL slug, `"my-post"`, which follows another field until edited by hand.
 *
 * Raw equivalent: `z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).meta({ widget: 'slug', widgetOptions: { from: 'title' } })`.
 */
export function slug(options: { from?: string } = {}) {
  return z
    .string()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .meta(withOptions('slug', { from: options.from }));
}

/** A web address. Raw equivalent: `z.url().meta({ widget: 'url' })`. */
export function url() {
  return z.url().meta({ widget: 'url' });
}

/** An email address. Raw equivalent: `z.email().meta({ widget: 'email', autocomplete: 'email' })`. */
export function email() {
  return z.email().meta({ widget: 'email', autocomplete: 'email' });
}

/**
 * A date and time, stored as ISO 8601. The editor shows the site's time zone in text.
 *
 * Raw equivalent: `z.coerce.date().meta({ widget: 'datetime' })`.
 */
export function datetime() {
  return z.coerce.date().meta({ widget: 'datetime' });
}

type SelectOptions =
  | readonly [string, ...string[]]
  | Readonly<Record<string, string>>
  | readonly { value: string; label: string }[];

/**
 * One of a fixed set of values. The editor shows the labels and stores the
 * values (a radio group for 4 or fewer options, otherwise a select).
 *
 * Raw equivalent: `z.enum(['a', 'b']).meta({ widgetOptions: { labels: { a: 'Alpha' } } })`.
 *
 * @param options Values (`['news', 'events']`), `{ value: label }`, or `[{ value, label }]`.
 */
export function select(options: SelectOptions) {
  const pairs: [string, string][] = Array.isArray(options)
    ? (options as readonly (string | { value: string; label: string })[]).map((option) =>
        typeof option === 'string' ? [option, option] : [option.value, option.label],
      )
    : Object.entries(options as Record<string, string>);
  const [first, ...rest] = pairs.map(([value]) => value);
  if (first === undefined) throw new Error('fields.select() needs at least one option.');
  return z.enum([first, ...rest]).meta({ widgetOptions: { labels: Object.fromEntries(pairs) } });
}

/**
 * Short rich text in frontmatter, stored as a Markdown string.
 *
 * Raw equivalent: `z.string().meta({ widget: 'markdown', widgetOptions: { inline: true } })`.
 */
export function markdown(options: { inline?: boolean } = {}) {
  return z.string().meta(withOptions('markdown', { inline: options.inline }));
}

/**
 * A non-image file (a PDF, say), stored as a relative path.
 *
 * Raw equivalent: `z.string().meta({ widget: 'file', widgetOptions: { accept: 'application/pdf' } })`.
 */
export function file(options: { accept?: string | string[] } = {}) {
  return z.string().meta(withOptions('file', { accept: options.accept }));
}

/** A share of the image, 0 to 1 from the top left (spec §6.6.2). */
const fraction = () => z.number().min(0).max(1);

/** A crop: a normalized rectangle that lies inside the image. */
const cropRect = () =>
  z
    .object({
      x: fraction(),
      y: fraction(),
      w: z.number().gt(0).max(1),
      h: z.number().gt(0).max(1),
    })
    .refine((rect) => rect.x + rect.w <= 1 + 1e-9 && rect.y + rect.h <= 1 + 1e-9, {
      message: 'The crop must lie inside the image.',
    });

/**
 * An image with alt text written for this page, an optional focal point and
 * optional crops per aspect ratio (spec §6.6.2). Pass `image` from the
 * schema function, so `src` is Astro's own `image()` and resolves to
 * `ImageMetadata`:
 *
 * ```ts
 * schema: ({ image }) => z.object({ hero: fields.image(image, { ratios: ['wide', 'square'] }) })
 * ```
 *
 * Stored as `{ src, alt, decorative?, focus?: { x, y }, crops?: { [ratio]: { x, y, w, h } } }`,
 * every number 0–1 from the top left. `alt` is required unless the image is
 * decorative, which stores `alt: ""` and `decorative: true`.
 *
 * Raw equivalent:
 * ```ts
 * z.object({
 *   src: image(),
 *   alt: z.string(),
 *   decorative: z.boolean().optional(),
 *   focus: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }).meta({ label: 'Focal point' }).optional(),
 *   crops: z.record(z.string(), z.object({
 *     x: z.number().min(0).max(1), y: z.number().min(0).max(1),
 *     w: z.number().gt(0).max(1), h: z.number().gt(0).max(1),
 *   }).refine((r) => r.x + r.w <= 1 + 1e-9 && r.y + r.h <= 1 + 1e-9, { message: 'The crop must lie inside the image.' })).optional(),
 * }).refine((v) => (v.decorative === true ? v.alt === '' : v.alt.trim() !== ''), {
 *   message: 'Describe this image, or mark it decorative.', path: ['alt'],
 * }).meta({ widget: 'image', widgetOptions: { ratios: ['wide', 'square'] } })
 * ```
 *
 * @param image Astro's `image` helper, from the collection's schema function.
 * @param options.ratios The ratio names (from `images.ratios` in vesper.config.ts)
 *   the editor previews and crops. Defaults to every ratio the site declares.
 */
export function image<Src extends z.ZodType>(
  image: () => Src,
  options: { ratios?: string[] } = {},
) {
  return z
    .object({
      src: image(),
      alt: z.string(),
      decorative: z.boolean().optional(),
      focus: z.object({ x: fraction(), y: fraction() }).meta({ label: 'Focal point' }).optional(),
      crops: z.record(z.string(), cropRect()).optional(),
    })
    .refine((value) => (value.decorative === true ? value.alt === '' : value.alt.trim() !== ''), {
      message: 'Describe this image, or mark it decorative.',
      path: ['alt'],
    })
    .meta(withOptions('image', { ratios: options.ratios ? [...options.ratios] : undefined }));
}

/**
 * Keeps the entry's page out of the site's own search (spec §6.19). The page
 * stays on the site; the studio shows a "Hide from site search" switch in
 * Details. The site's layout can read the same value for
 * `<meta name="robots">` if it wants search engines to skip the page too.
 *
 * Raw equivalent: `z.boolean().default(false).meta({ label: 'Hide from site search', description: 'The page stays on the site. It just won’t show up in the site’s own search.', placement: 'details', search: 'hide' })`.
 */
export function hideFromSearch() {
  return z.boolean().default(false).meta({
    label: 'Hide from site search',
    description: 'The page stays on the site. It just won’t show up in the site’s own search.',
    placement: 'details',
    search: 'hide',
  });
}

/** `{ widget }`, plus `widgetOptions` only when an option was given, matching the documented raw Zod. */
function withOptions(widget: string, options: Record<string, unknown>): Record<string, unknown> {
  const defined = Object.fromEntries(
    Object.entries(options).filter(([, value]) => value !== undefined),
  );
  return Object.keys(defined).length > 0 ? { widget, widgetOptions: defined } : { widget };
}

export const fields = {
  color,
  geo,
  slug,
  url,
  email,
  datetime,
  select,
  markdown,
  file,
  image,
  hideFromSearch,
};
