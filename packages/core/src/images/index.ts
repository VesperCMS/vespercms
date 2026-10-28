/*
 * `@vespercms/core/images`: aspect ratios, focal points and crops (spec §6.6).
 * Plain arithmetic with no dependencies, shared by the studio's previews and
 * crop dialog, `<Img>` and the build's crop step, so all three cut the same
 * rectangle.
 */
export { BUILT_IN_RATIOS, RATIO_NAME, isRatio, ratioLabel, siteRatios } from './ratios.ts';
export {
  CENTER,
  MIN_CROP,
  clampRect,
  cropForRatio,
  dragCorner,
  fitCrop,
  focalCrop,
  focusWithin,
  imageValueOf,
  isCropRect,
  isFocalPoint,
  moveRect,
  objectPosition,
  pixelRect,
  ratioBox,
  resizeRect,
  roundFocus,
  roundRect,
  sharpAnchor,
  type Corner,
  type CropRect,
  type FocalPoint,
  type ImageSize,
  type ImageValue,
} from './geometry.ts';
