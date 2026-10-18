/*
 * Focal points and crops (spec §6.6.2): every value is a fraction of the
 * image, 0 to 1 from the top left, so it survives the image being resized
 * and means the same in the studio, the build and `<Img>`. All coordinates
 * are on the upright image, the way browsers show it.
 */

export type FocalPoint = { x: number; y: number };

/** A normalized rectangle: `x` and `y` of its top left corner, `w` and `h` its size. */
export type CropRect = { x: number; y: number; w: number; h: number };

export type ImageSize = { width: number; height: number };

/** What an image field stores beside `src` and `alt`, read defensively. */
export type ImageValue = { focus?: FocalPoint; crops: Record<string, CropRect> };

export const CENTER: FocalPoint = { x: 0.5, y: 0.5 };

/** The smallest crop the studio makes: 5% of the image's width or height. */
export const MIN_CROP = 0.05;

/** A stored crop within this much of its ratio's shape is used as is. */
const SHAPE_TOLERANCE = 0.005;

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));
const clamp01 = (n: number) => clamp(n, 0, 1);
const isFraction = (n: unknown): n is number =>
  typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1;

export function isFocalPoint(value: unknown): value is FocalPoint {
  if (typeof value !== 'object' || value === null) return false;
  const { x, y } = value as Record<string, unknown>;
  return isFraction(x) && isFraction(y);
}

/** A rectangle that lies inside the image and isn't empty. */
export function isCropRect(value: unknown): value is CropRect {
  if (typeof value !== 'object' || value === null) return false;
  const { x, y, w, h } = value as Record<string, unknown>;
  return (
    isFraction(x) &&
    isFraction(y) &&
    isFraction(w) &&
    isFraction(h) &&
    w > 0 &&
    h > 0 &&
    x + w <= 1 + 1e-9 &&
    y + h <= 1 + 1e-9
  );
}

/** `focus` and `crops` from an image field's value. Anything malformed is ignored, never thrown. */
export function imageValueOf(value: unknown): ImageValue {
  const record =
    typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
  const crops: Record<string, CropRect> = {};
  if (typeof record.crops === 'object' && record.crops !== null) {
    for (const [name, rect] of Object.entries(record.crops)) {
      if (isCropRect(rect)) crops[name] = { x: rect.x, y: rect.y, w: rect.w, h: rect.h };
    }
  }
  return isFocalPoint(record.focus)
    ? { focus: { x: record.focus.x, y: record.focus.y }, crops }
    : { crops };
}

/** The normalized size of the largest rectangle of `ratio` that fits the image. */
export function ratioBox(size: ImageSize, ratio: number): { w: number; h: number } {
  const imageRatio = size.width / size.height;
  return imageRatio > ratio ? { w: ratio / imageRatio, h: 1 } : { w: 1, h: imageRatio / ratio };
}

/** The largest rectangle of `ratio`, centred on the focal point (the centre when none), inside the image. */
export function focalCrop(size: ImageSize, ratio: number, focus: FocalPoint = CENTER): CropRect {
  const { w, h } = ratioBox(size, ratio);
  return {
    x: clamp(focus.x - w / 2, 0, 1 - w),
    y: clamp(focus.y - h / 2, 0, 1 - h),
    w,
    h,
  };
}

/** Keeps a rectangle inside the image, moving it rather than shrinking it where it can. */
export function clampRect(rect: CropRect): CropRect {
  const w = clamp(rect.w, Number.EPSILON, 1);
  const h = clamp(rect.h, Number.EPSILON, 1);
  return { x: clamp(rect.x, 0, 1 - w), y: clamp(rect.y, 0, 1 - h), w, h };
}

/**
 * A stored crop, made to fit its ratio. One whose shape no longer matches
 * (the image was replaced by one of another shape) is trimmed to the ratio
 * around its own centre, so it never grows past what the editor chose.
 */
export function fitCrop(rect: CropRect, ratio: number, size: ImageSize): CropRect {
  const inside = clampRect(rect);
  const shape = (inside.w * size.width) / (inside.h * size.height);
  if (Math.abs(shape / ratio - 1) <= SHAPE_TOLERANCE) return inside;
  if (shape > ratio) {
    const w = (inside.h * size.height * ratio) / size.width;
    return { ...inside, x: inside.x + (inside.w - w) / 2, w };
  }
  const h = (inside.w * size.width) / ratio / size.height;
  return { ...inside, y: inside.y + (inside.h - h) / 2, h };
}

/**
 * The crop for one ratio: the editor's own for that ratio name when there is
 * one (`custom`), otherwise the one the focal point gives. A manual crop
 * never affects any other ratio (spec §6.6.2).
 */
export function cropForRatio(
  value: ImageValue,
  name: string | undefined,
  ratio: number,
  size: ImageSize,
): { rect: CropRect; custom: boolean } {
  const stored = name === undefined ? undefined : value.crops[name];
  return stored
    ? { rect: fitCrop(stored, ratio, size), custom: true }
    : { rect: focalCrop(size, ratio, value.focus), custom: false };
}

/** A normalized rectangle in whole pixels, inside the image and at least one pixel each way. */
export function pixelRect(
  rect: CropRect,
  size: ImageSize,
): { left: number; top: number; width: number; height: number } {
  const left = clamp(Math.round(rect.x * size.width), 0, size.width - 1);
  const top = clamp(Math.round(rect.y * size.height), 0, size.height - 1);
  return {
    left,
    top,
    width: clamp(Math.round(rect.w * size.width), 1, size.width - left),
    height: clamp(Math.round(rect.h * size.height), 1, size.height - top),
  };
}

/** Moves a rectangle by a fraction of the image, stopping at the edges. */
export function moveRect(rect: CropRect, dx: number, dy: number): CropRect {
  return {
    ...rect,
    x: clamp(rect.x + dx, 0, 1 - rect.w),
    y: clamp(rect.y + dy, 0, 1 - rect.h),
  };
}

/**
 * Resizes a crop to a new width, keeping its ratio and its centre, then
 * moves it back inside the image if it crossed an edge. From `MIN_CROP` up
 * to the largest rectangle of the ratio.
 */
export function resizeRect(rect: CropRect, w: number, ratio: number, size: ImageSize): CropRect {
  const box = ratioBox(size, ratio);
  const minW = Math.min(box.w, MIN_CROP * Math.max(1, box.w / box.h));
  const nextW = clamp(w, minW, box.w);
  const nextH = (nextW * box.h) / box.w;
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  return clampRect({ x: cx - nextW / 2, y: cy - nextH / 2, w: nextW, h: nextH });
}

export type Corner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

/**
 * Drags one corner of a crop to a point, keeping its ratio and the opposite
 * corner where it is. The crop follows whichever way the pointer moved
 * further, and stops at the image's edges and at `MIN_CROP`.
 */
export function dragCorner(
  rect: CropRect,
  corner: Corner,
  point: FocalPoint,
  ratio: number,
  size: ImageSize,
): CropRect {
  const right = corner.endsWith('right');
  const bottom = corner.startsWith('bottom');
  // The corner that stays put.
  const ax = right ? rect.x : rect.x + rect.w;
  const ay = bottom ? rect.y : rect.y + rect.h;
  const box = ratioBox(size, ratio);
  const perW = box.h / box.w;
  // Room from the anchor to the image's edges, in the drag's direction.
  const roomX = right ? 1 - ax : ax;
  const roomY = bottom ? 1 - ay : ay;
  const maxW = Math.min(roomX, roomY / perW, box.w);
  const minW = Math.min(maxW, MIN_CROP * Math.max(1, box.w / box.h));
  const wanted = Math.max(
    (right ? point.x - ax : ax - point.x) || 0,
    ((bottom ? point.y - ay : ay - point.y) || 0) / perW,
  );
  const w = clamp(wanted, minW, maxW);
  const h = w * perW;
  return { x: right ? ax : ax - w, y: bottom ? ay : ay - h, w, h };
}

/** The focal point as a fraction of a rectangle cut from the image (the centre when none). */
export function focusWithin(rect: CropRect, focus: FocalPoint = CENTER): FocalPoint {
  return { x: clamp01((focus.x - rect.x) / rect.w), y: clamp01((focus.y - rect.y) / rect.h) };
}

const percent = (n: number) => String(Math.round(n * 10000) / 100);

/** CSS `object-position` for a focal point: `62% 35%`. */
export function objectPosition(focus: FocalPoint): string {
  return `${percent(focus.x)}% ${percent(focus.y)}%`;
}

/**
 * Where Astro's own server crop lands when Vesper's crop step is off. Sharp
 * places a ratio's largest rectangle by one of nine anchors and takes only
 * its own keywords (DECISIONS.md, "Astro hands `position` to Sharp
 * unchanged"), so this picks the anchor nearest to the wanted crop's centre
 * and returns the rectangle Sharp will cut there.
 */
export function sharpAnchor(
  rect: CropRect,
  ratio: number,
  size: ImageSize,
): { position: string; rect: CropRect } {
  const box = ratioBox(size, ratio);
  // 0 is the left (top) edge, 1 the right (bottom), for the box's travel.
  const travel = (centre: number, length: number) =>
    length >= 1 - 1e-9 ? 0.5 : clamp01((centre - length / 2) / (1 - length));
  const snap = (t: number) => (t < 0.25 ? 0 : t > 0.75 ? 1 : 0.5);
  const tx = snap(travel(rect.x + rect.w / 2, box.w));
  const ty = snap(travel(rect.y + rect.h / 2, box.h));
  // The box always fills one direction, so at most one of these is set.
  const across = tx === 0 ? 'left' : tx === 1 ? 'right' : '';
  const down = ty === 0 ? 'top' : ty === 1 ? 'bottom' : '';
  const position = across || down || 'center';
  return { position, rect: { x: tx * (1 - box.w), y: ty * (1 - box.h), w: box.w, h: box.h } };
}

/** Two decimals: the 1% steps the studio's control moves in. */
export function roundFocus(focus: FocalPoint): FocalPoint {
  const round = (n: number) => Math.round(clamp01(n) * 100) / 100;
  return { x: round(focus.x), y: round(focus.y) };
}

/** Four decimals: a tenth of a pixel on a 1,000-pixel image, and short in the file. */
export function roundRect(rect: CropRect): CropRect {
  const round = (n: number) => Math.round(n * 10000) / 10000;
  const w = round(rect.w);
  const h = round(rect.h);
  return {
    x: Math.min(round(rect.x), round(1 - w)),
    y: Math.min(round(rect.y), round(1 - h)),
    w,
    h,
  };
}
