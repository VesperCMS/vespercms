/*
 * `@vesper/astro/components` (spec §6.6.5): `<Img>`, and `getImg()` for the
 * places an `<img>` can't go, such as `og:image`. Shipped as source, like the
 * `/admin` page, for the site's own Astro to compile.
 */
import type { GetImageResult } from 'astro';
import { getImage, imageConfig } from 'astro:assets';
import { imageContext, planImg, type CroppedImageProps } from '@vesper/astro/images';
import { ratios } from 'virtual:vesper/images';

export { default as Img } from './Img.astro';
export type {
  CroppedImageProps,
  ImageFieldValue,
  ImgProps,
  RatioInput,
} from '@vesper/astro/images';

/**
 * One image field's image, cropped like `<Img>` would crop it, as Astro's
 * `getImage()` result:
 *
 * ```astro
 * const og = await getImg({ image: post.data.hero, ratio: 'og', width: 1200 });
 * <meta property="og:image" content={new URL(og.src, Astro.site)} />
 * ```
 */
export async function getImg(props: CroppedImageProps): Promise<GetImageResult> {
  const options = planImg(props, imageContext(imageConfig, ratios));
  return getImage(options as Parameters<typeof getImage>[0]);
}
