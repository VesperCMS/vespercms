/*
 * `@vesper/astro/images`: what `<Img>` asks Astro for, as plain functions
 * (spec §6.6.5). `<Img>` and `getImg()` live in `@vesper/astro/components`;
 * this is their planning, importable anywhere, plus the types.
 */
export {
  imageContext,
  mimeType,
  planArt,
  planImg,
  type ArtPlan,
  type CroppedImageProps,
  type ImageContext,
  type ImageFieldValue,
  type ImageProps,
  type ImgProps,
  type RatioInput,
} from './plan.ts';
export { serviceKind, type ServiceKind } from './register.ts';
