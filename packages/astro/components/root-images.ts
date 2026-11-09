import type { ImageMetadata } from 'astro';

/*
 * An image field from a Markdoc tag's or MDX component's settings stores a
 * path from the site's root, `/src/assets/barn.jpg` (`fields.image()` with no
 * helper): the tag's component doesn't know which entry it's in, so a path
 * relative to the entry couldn't be found. Astro resolves frontmatter images
 * itself, but not tag attributes, so `<Img>` and `getImg()` look the path up
 * here. The glob is lazy: only the images a page shows are loaded.
 */
const images = import.meta.glob<{ default: ImageMetadata }>(
  '/src/**/*.{jpg,jpeg,png,webp,avif,gif,svg,tif,tiff,JPG,JPEG,PNG,WEBP}',
);

/** The image field with a `/src/…` path swapped for Astro's image; anything else as it is. */
export async function resolveRootImage<T>(image: T): Promise<T> {
  const src = (image as { src?: unknown } | null)?.src;
  if (typeof src !== 'string' || !src.startsWith('/src/')) return image;
  const load = images[src];
  if (!load)
    throw new Error(
      `<Img>: “${src}” isn’t an image under src/. Check the path, or choose the image again in the studio.`,
    );
  return { ...(image as object), src: (await load()).default } as T;
}
