/*
 * Aspect ratios (spec §6.6.3): declared once in vesper.config.ts, used by
 * the studio's crop previews and by `<Img ratio>`, so editors see exactly
 * the crops the site renders.
 */

/** Ratios every site has. `og` is the shape social networks show link images in. */
export const BUILT_IN_RATIOS: Readonly<Record<string, number>> = { og: 1.91 };

/** A ratio name: a word, as in `wide`, `square` or `card-small`. */
export const RATIO_NAME = /^[A-Za-z][\w-]*$/;

/** The site's ratios: its own, in their order, then the built-in ones it doesn't redefine. */
export function siteRatios(
  declared: Readonly<Record<string, number>> = {},
): Record<string, number> {
  const ratios: Record<string, number> = { ...declared };
  for (const [name, ratio] of Object.entries(BUILT_IN_RATIOS)) {
    if (!(name in ratios)) ratios[name] = ratio;
  }
  return ratios;
}

/** True for a ratio a crop can have: a finite number above zero. */
export function isRatio(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

/**
 * A ratio as people write it: `16:9`, `1:1`, `4:5`. Ratios that aren't a
 * small fraction keep their decimals: `1.91:1`, or `1:1.33` when taller.
 */
export function ratioLabel(ratio: number): string {
  for (let denominator = 1; denominator <= 20; denominator++) {
    const numerator = Math.round(ratio * denominator);
    if (numerator > 0 && Math.abs(numerator / denominator - ratio) < 1e-6 * ratio) {
      return `${String(numerator)}:${String(denominator)}`;
    }
  }
  const twoPlaces = (n: number) => String(Math.round(n * 100) / 100);
  return ratio >= 1 ? `${twoPlaces(ratio)}:1` : `1:${twoPlaces(1 / ratio)}`;
}
