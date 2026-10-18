import { describe, expect, it } from 'vitest';
import {
  clampRect,
  cropForRatio,
  dragCorner,
  fitCrop,
  focalCrop,
  focusWithin,
  imageValueOf,
  isCropRect,
  moveRect,
  objectPosition,
  pixelRect,
  ratioBox,
  resizeRect,
  roundFocus,
  roundRect,
  sharpAnchor,
  type CropRect,
} from './geometry.ts';

/** The playground's harbor illustration: 3:2. */
const harbor = { width: 2400, height: 1600 };
const portrait = { width: 1200, height: 1600 };

const close = (rect: CropRect, expected: CropRect) => {
  for (const key of ['x', 'y', 'w', 'h'] as const) expect(rect[key]).toBeCloseTo(expected[key], 6);
};

/** The rectangle's shape in pixels, as a ratio. */
const shape = (rect: CropRect, size = harbor) => (rect.w * size.width) / (rect.h * size.height);

describe('ratioBox', () => {
  it('is the full height for a ratio narrower than the image, and the full width otherwise', () => {
    expect(ratioBox(harbor, 1)).toEqual({ w: 1 / 1.5, h: 1 });
    expect(ratioBox(harbor, 16 / 9).w).toBe(1);
    expect(ratioBox(harbor, 16 / 9).h).toBeCloseTo(1350 / 1600, 9);
    expect(ratioBox(harbor, 1.5)).toEqual({ w: 1, h: 1 });
  });
});

describe('focalCrop', () => {
  it('is the largest rectangle of the ratio, centred on the focal point', () => {
    const square = focalCrop(harbor, 1, { x: 0.5, y: 0.5 });
    close(square, { x: (1 - 1 / 1.5) / 2, y: 0, w: 1 / 1.5, h: 1 });
    expect(shape(square)).toBeCloseTo(1, 9);
  });

  it('uses the centre when there is no focal point', () => {
    expect(focalCrop(harbor, 1)).toEqual(focalCrop(harbor, 1, { x: 0.5, y: 0.5 }));
  });

  it('follows the focal point, and stops at every edge', () => {
    // The playground's focus: 62% across. A square 2/3 wide fits from 0 to 1/3.
    expect(focalCrop(harbor, 1, { x: 0.62, y: 0.35 }).x).toBeCloseTo(0.62 - 1 / 3, 9);
    expect(focalCrop(harbor, 1, { x: 0, y: 0 }).x).toBe(0);
    expect(focalCrop(harbor, 1, { x: 1, y: 1 }).x).toBeCloseTo(1 / 3, 9);
    const wide = focalCrop(harbor, 16 / 9, { x: 0.62, y: 0 });
    expect(wide.y).toBe(0);
    expect(focalCrop(harbor, 16 / 9, { x: 0.62, y: 1 }).y).toBeCloseTo(1 - wide.h, 9);
    expect(focalCrop(harbor, 16 / 9, { x: 0.62, y: 0.35 }).x).toBe(0);
  });

  it('keeps every ratio the right shape, on landscape and portrait images', () => {
    for (const size of [harbor, portrait, { width: 1000, height: 1000 }]) {
      for (const ratio of [16 / 9, 1, 4 / 5, 1.91, 9 / 16]) {
        const rect = focalCrop(size, ratio, { x: 0.3, y: 0.8 });
        expect(shape(rect, size)).toBeCloseTo(ratio, 9);
        expect(isCropRect(rect)).toBe(true);
      }
    }
  });
});

describe('cropForRatio', () => {
  const value = {
    focus: { x: 0.62, y: 0.35 },
    crops: { square: { x: 0.4, y: 0.1, w: 0.45, h: 0.675 } },
  };

  it('uses a manual crop for its own ratio only', () => {
    expect(cropForRatio(value, 'square', 1, harbor)).toEqual({
      rect: value.crops.square,
      custom: true,
    });
    expect(cropForRatio(value, 'wide', 16 / 9, harbor)).toEqual({
      rect: focalCrop(harbor, 16 / 9, value.focus),
      custom: false,
    });
    // A ratio given as a number has no name, so no manual crop applies.
    expect(cropForRatio(value, undefined, 1, harbor).custom).toBe(false);
  });

  it('falls back to the centre with neither a focal point nor a crop', () => {
    expect(cropForRatio({ crops: {} }, 'square', 1, harbor).rect).toEqual(focalCrop(harbor, 1));
  });
});

describe('fitCrop', () => {
  it('keeps a crop of the right shape as it is', () => {
    const rect = { x: 0.4, y: 0.1, w: 0.45, h: 0.675 };
    expect(fitCrop(rect, 1, harbor)).toEqual(rect);
  });

  it('trims a crop that no longer fits its ratio around its own centre', () => {
    // Square on a 3:2 image, then the image was replaced with a square one.
    const trimmed = fitCrop({ x: 0.4, y: 0.1, w: 0.45, h: 0.675 }, 1, {
      width: 1000,
      height: 1000,
    });
    close(trimmed, { x: 0.4, y: 0.1 + (0.675 - 0.45) / 2, w: 0.45, h: 0.45 });
    const wide = fitCrop({ x: 0, y: 0, w: 1, h: 1 }, 16 / 9, harbor);
    expect(shape(wide)).toBeCloseTo(16 / 9, 9);
    expect(wide.w).toBe(1);
  });

  it('moves a crop that spills over the edge back inside', () => {
    expect(fitCrop({ x: 0.9, y: 0, w: 0.2, h: 0.3 }, 1, harbor).x).toBeCloseTo(0.8, 9);
  });
});

describe('pixelRect', () => {
  it('rounds to whole pixels inside the image', () => {
    expect(pixelRect({ x: 0.4, y: 0.1, w: 0.45, h: 0.675 }, harbor)).toEqual({
      left: 960,
      top: 160,
      width: 1080,
      height: 1080,
    });
    expect(pixelRect({ x: 0.9999, y: 0.9999, w: 0.0001, h: 0.0001 }, harbor)).toEqual({
      left: 2399,
      top: 1599,
      width: 1,
      height: 1,
    });
  });
});

describe('moving and resizing', () => {
  const square = focalCrop(harbor, 1);

  it('moves within the image', () => {
    expect(moveRect(square, 0.01, 0).x).toBeCloseTo(square.x + 0.01, 9);
    expect(moveRect(square, 1, 1)).toEqual({ ...square, x: 1 - square.w, y: 0 });
    expect(moveRect(square, -1, -1)).toEqual({ ...square, x: 0, y: 0 });
  });

  it('resizes around the centre, keeping the ratio, between the minimum and the largest box', () => {
    const smaller = resizeRect(square, square.w - 0.1, 1, harbor);
    expect(shape(smaller)).toBeCloseTo(1, 9);
    expect(smaller.x + smaller.w / 2).toBeCloseTo(square.x + square.w / 2, 9);
    expect(resizeRect(square, 5, 1, harbor)).toEqual(square);
    const tiny = resizeRect(square, 0, 1, harbor);
    expect(Math.min(tiny.w, tiny.h)).toBeCloseTo(0.05, 9);
  });

  it('moves a growing crop back inside rather than past an edge', () => {
    const cornered = { x: 0, y: 0, w: 0.2, h: 0.3 };
    const grown = resizeRect(cornered, 0.4, 1, harbor);
    expect(grown.x).toBe(0);
    expect(grown.y).toBe(0);
    expect(shape(grown)).toBeCloseTo(1, 9);
  });

  it('drags a corner, keeping the opposite corner and the ratio', () => {
    const start = { x: 0.2, y: 0.2, w: 0.2, h: 0.3 };
    const dragged = dragCorner(start, 'bottom-right', { x: 0.6, y: 0.5 }, 1, harbor);
    expect(dragged.x).toBe(0.2);
    expect(dragged.y).toBe(0.2);
    expect(dragged.w).toBeCloseTo(0.4, 9);
    expect(shape(dragged)).toBeCloseTo(1, 9);
    const fromTopLeft = dragCorner(start, 'top-left', { x: 0.1, y: 0.15 }, 1, harbor);
    expect(fromTopLeft.x + fromTopLeft.w).toBeCloseTo(0.4, 9);
    expect(fromTopLeft.y + fromTopLeft.h).toBeCloseTo(0.5, 9);
  });

  it('stops a dragged corner at the image edge and at the minimum size', () => {
    const start = { x: 0.2, y: 0.2, w: 0.2, h: 0.3 };
    const big = dragCorner(start, 'bottom-right', { x: 2, y: 2 }, 1, harbor);
    expect(big.y + big.h).toBeCloseTo(1, 9);
    expect(isCropRect(big)).toBe(true);
    const flipped = dragCorner(start, 'bottom-right', { x: 0, y: 0 }, 1, harbor);
    expect(flipped.x).toBe(0.2);
    expect(Math.min(flipped.w, flipped.h)).toBeCloseTo(0.05, 9);
  });

  it('clamps any rectangle into the image', () => {
    expect(clampRect({ x: -1, y: 2, w: 3, h: 0.5 })).toEqual({ x: 0, y: 0.5, w: 1, h: 0.5 });
  });
});

describe('focal points on the page', () => {
  it('writes object-position in percent', () => {
    expect(objectPosition({ x: 0.62, y: 0.35 })).toBe('62% 35%');
    expect(objectPosition({ x: 1 / 3, y: 0 })).toBe('33.33% 0%');
  });

  it('places the focal point within a crop', () => {
    expect(focusWithin({ x: 0.5, y: 0, w: 0.5, h: 1 }, { x: 0.75, y: 0.35 })).toEqual({
      x: 0.5,
      y: 0.35,
    });
    expect(focusWithin({ x: 0.5, y: 0, w: 0.5, h: 1 }, { x: 0.1, y: 0.35 }).x).toBe(0);
    expect(focusWithin({ x: 0, y: 0, w: 1, h: 1 })).toEqual({ x: 0.5, y: 0.5 });
  });
});

describe('sharpAnchor', () => {
  it('picks the nearest of Sharp’s nine anchors, in Sharp’s own words', () => {
    const square = (x: number) => focalCrop(harbor, 1, { x, y: 0.5 });
    expect(sharpAnchor(square(0), 1, harbor).position).toBe('left');
    expect(sharpAnchor(square(0.5), 1, harbor).position).toBe('center');
    expect(sharpAnchor(square(0.62), 1, harbor).position).toBe('right');
    const wide = (y: number) => focalCrop(harbor, 16 / 9, { x: 0.5, y });
    expect(sharpAnchor(wide(0), 16 / 9, harbor).position).toBe('top');
    expect(sharpAnchor(wide(1), 16 / 9, harbor).position).toBe('bottom');
    const corner = focalCrop(portrait, 16 / 9, { x: 0.5, y: 0 });
    expect(sharpAnchor(corner, 16 / 9, portrait).position).toBe('top');
    // A cover crop always fills one direction, so only the other can move.
    expect(
      sharpAnchor({ x: 0, y: 0, w: 0.2, h: 0.2 }, 1.2, { width: 1000, height: 1000 }).position,
    ).toBe('top');
  });

  it('returns the rectangle Sharp cuts there: the ratio’s whole box', () => {
    const { rect } = sharpAnchor({ x: 0.4, y: 0.1, w: 0.45, h: 0.675 }, 1, harbor);
    close(rect, { x: 1 / 3, y: 0, w: 2 / 3, h: 1 });
  });
});

describe('reading and rounding stored values', () => {
  it('reads focus and crops, ignoring anything malformed', () => {
    expect(
      imageValueOf({
        src: 'x.jpg',
        focus: { x: 0.62, y: 0.35 },
        crops: {
          square: { x: 0.4, y: 0.1, w: 0.45, h: 0.675 },
          broken: { x: 0.9, y: 0, w: 0.5, h: 0.5 },
          text: 'wide',
        },
      }),
    ).toEqual({
      focus: { x: 0.62, y: 0.35 },
      crops: { square: { x: 0.4, y: 0.1, w: 0.45, h: 0.675 } },
    });
    expect(imageValueOf({ focus: { x: 2, y: 0 } })).toEqual({ crops: {} });
    expect(imageValueOf('x.jpg')).toEqual({ crops: {} });
  });

  it('rounds focal points to 1% and crops to four decimals, still inside the image', () => {
    expect(roundFocus({ x: 0.6249, y: 1.2 })).toEqual({ x: 0.62, y: 1 });
    const rounded = roundRect({ x: 1 / 3, y: 0.123456, w: 2 / 3, h: 0.5 });
    expect(rounded).toEqual({ x: 0.3333, y: 0.1235, w: 0.6667, h: 0.5 });
    expect(isCropRect(rounded)).toBe(true);
  });
});
