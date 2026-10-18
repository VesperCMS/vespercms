/*
 * WCAG 2.1 contrast (success criterion 1.4.3), for colours from
 * `fields.color()`: the relative-luminance ratio of two sRGB colours.
 */

export type Rgb = { r: number; g: number; b: number };

/** `#rgb`, `#rrggbb` or `#rrggbbaa` (alpha ignored: a field's colour is drawn as given). */
export function parseHexColor(value: string): Rgb | null {
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(value.trim());
  const hex = match?.[1];
  if (!hex) return null;
  const full =
    hex.length === 3
      ? hex
          .split('')
          .map((c) => c + c)
          .join('')
      : hex.slice(0, 6);
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  };
}

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance({ r, g, b }: Rgb): number {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** The contrast ratio of two colours, from 1 to 21, or null if either isn't a hex colour. */
export function contrastRatio(a: string, b: string): number | null {
  const x = parseHexColor(a);
  const y = parseHexColor(b);
  if (!x || !y) return null;
  const [light, dark] = [relativeLuminance(x), relativeLuminance(y)].sort((p, q) => q - p) as [
    number,
    number,
  ];
  return (light + 0.05) / (dark + 0.05);
}

/**
 * A ratio for a message, rounded down to one decimal ("4.4:1"), so a colour
 * that fails never reads as if it passed.
 */
export function formatRatio(ratio: number): string {
  const down = Math.floor(ratio * 10) / 10;
  return `${String(down)}:1`;
}

/** What a colour field is used for, and the minimum contrast WCAG 2.1 AA asks of it. */
export type ContrastUse = 'text' | 'large-text' | 'graphic';

export const CONTRAST_MINIMUM: Readonly<Record<ContrastUse, number>> = {
  text: 4.5,
  'large-text': 3,
  graphic: 3,
};

export function isContrastUse(value: unknown): value is ContrastUse {
  return value === 'text' || value === 'large-text' || value === 'graphic';
}
