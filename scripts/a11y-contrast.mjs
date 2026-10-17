/**
 * Colour-contrast and design-budget check for packages/ui/src/tokens.css.
 *
 * The check parses the token file directly. Taproot's version mirrored the values by hand, so
 * the check and the CSS could drift apart. It fails when:
 *
 * - a colour pair that occurs in the UI misses its WCAG 2.1 threshold in either theme: 4.5:1
 *   for text (SC 1.4.3), 3:1 for UI components and focus indicators (SC 1.4.11);
 * - a colour token is outside the spec §10.4 budget allowlist;
 * - a colour token is neither in a checked pair nor explicitly marked decorative;
 * - a colour isn't a plain `light-dark(oklch(…), oklch(…))` pair, or is declared outside `@theme`.
 *
 * axe can't do this: jsdom computes no layout and resolves no custom properties.
 *
 * Usage: node scripts/a11y-contrast.mjs [path/to/tokens.css]
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * The spec §10.4 budget. Neutrals are unlimited in principle but listed, so a new token is
 * always a deliberate change to this file. Beyond neutrals: accent (+hover), accent-subtle,
 * danger, focus, warning.
 */
export const ALLOWED_TOKENS = {
  neutral: [
    'surface',
    'surface-raised',
    'surface-sunken',
    'border',
    'border-strong',
    'content',
    'content-muted',
    'on-accent',
  ],
  role: ['accent', 'accent-hover', 'accent-subtle', 'danger', 'focus', 'warning'],
};

/** Tokens exempt from contrast pairs, with the reason. */
export const DECORATIVE = {
  border: 'hairline separators between regions; not a component boundary (SC 1.4.11 exempt)',
};

/** Pairs that occur in the UI: [foreground, background, threshold, where]. */
export const PAIRS = [
  ['content', 'surface', 4.5, 'body text on the page'],
  ['content', 'surface-raised', 4.5, 'body text in dialogs, menus and drawers'],
  ['content', 'surface-sunken', 4.5, 'text in inputs and table headers'],
  ['content', 'accent-subtle', 4.5, 'text on the selected row or current-location item'],
  ['content-muted', 'surface', 4.5, 'secondary text: who edited and when, help text'],
  ['content-muted', 'surface-raised', 4.5, 'secondary text in overlays'],
  ['content-muted', 'surface-sunken', 4.5, 'placeholder-free hints inside inputs'],
  ['accent', 'surface', 4.5, 'links and quiet buttons on the page'],
  ['accent', 'surface-raised', 4.5, 'links in overlays'],
  ['on-accent', 'accent', 4.5, 'primary button label'],
  ['on-accent', 'accent-hover', 4.5, 'primary button label, hovered'],
  ['on-accent', 'danger', 4.5, 'danger button label (confirm delete)'],
  ['danger', 'surface', 4.5, 'inline error messages'],
  ['danger', 'surface-raised', 4.5, 'inline error messages in dialogs'],
  ['danger', 'surface-sunken', 4.5, 'error text inside a field group'],
  ['border-strong', 'surface', 3, 'input and checkbox boundaries'],
  ['border-strong', 'surface-raised', 3, 'input boundaries in dialogs'],
  ['border-strong', 'surface-sunken', 3, 'input boundaries on sunken regions'],
  ['focus', 'surface', 3, 'focus ring on the page'],
  ['focus', 'surface-raised', 3, 'focus ring in overlays'],
  ['focus', 'surface-sunken', 3, 'focus ring on sunken regions'],
  ['focus', 'accent-subtle', 3, 'focus ring on the selected row'],
  ['warning', 'surface', 3, 'warning marker beside a field'],
  ['warning', 'surface-raised', 3, 'warning marker in overlays'],
];

const OKLCH = String.raw`oklch\(\s*([\d.]+)%\s+([\d.]+)\s+([\d.]+)\s*\)`;
const LIGHT_DARK = new RegExp(String.raw`^light-dark\(\s*${OKLCH}\s*,\s*${OKLCH}\s*\)$`);

/**
 * Parses `--color-*` tokens out of a token stylesheet.
 * @param {string} css
 * @returns {{ light: Record<string, number[]>, dark: Record<string, number[]>, errors: string[] }}
 */
export function parseTokens(css) {
  const source = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const light = {};
  const dark = {};
  const errors = [];

  const themeBlocks = [...source.matchAll(/@theme\s*\{([^}]*)\}/g)];
  if (themeBlocks.length === 0) errors.push('No @theme block found.');

  for (const [, body] of themeBlocks) {
    for (const declaration of body.split(';')) {
      const match = /^\s*--color-([a-z0-9-]+|\*)\s*:\s*([\s\S]+?)\s*$/.exec(declaration);
      if (!match) continue;
      const [, name, value] = match;
      if (name === '*') {
        if (value !== 'initial')
          errors.push(`--color-* must only be reset to initial (got ${value}).`);
        continue;
      }
      const pair = LIGHT_DARK.exec(value.replace(/\s+/g, ' '));
      if (!pair) {
        errors.push(
          `--color-${name} must be light-dark(oklch(L% C H), oklch(L% C H)) with no alpha (got ${value}).`,
        );
        continue;
      }
      const numbers = pair.slice(1).map(Number);
      light[name] = numbers.slice(0, 3);
      dark[name] = numbers.slice(3, 6);
    }
  }

  const outside = source.replace(/@theme\s*\{[^}]*\}/g, '');
  for (const [, name] of outside.matchAll(/(--color-[a-z0-9-]+)\s*:/g)) {
    errors.push(
      `${name} is declared outside @theme; switch themes with color-scheme, not by redefining tokens.`,
    );
  }

  return { light, dark, errors };
}

/** oklch → linear-light sRGB (Björn Ottosson's OKLab matrices). */
export function oklchToLinearSrgb(lPercent, chroma, hueDegrees) {
  const L = lPercent / 100;
  const h = (hueDegrees * Math.PI) / 180;
  const a = chroma * Math.cos(h);
  const b = chroma * Math.sin(h);

  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;

  return [
    +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

export function isInGamut(color, epsilon = 0.002) {
  return oklchToLinearSrgb(...color).every((v) => v >= -epsilon && v <= 1 + epsilon);
}

/** WCAG relative luminance. Linear-light sRGB is what the formula wants. */
function luminance([r, g, b]) {
  const clamp = (v) => Math.min(1, Math.max(0, v));
  return 0.2126 * clamp(r) + 0.7152 * clamp(g) + 0.0722 * clamp(b);
}

export function contrastRatio(colorA, colorB) {
  const a = luminance(oklchToLinearSrgb(...colorA));
  const b = luminance(oklchToLinearSrgb(...colorB));
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Runs every check. Returns per-pair results plus policy errors and warnings.
 * @param {ReturnType<typeof parseTokens>} tokens
 */
export function checkTokens(
  tokens,
  { pairs = PAIRS, allowed = ALLOWED_TOKENS, decorative = DECORATIVE } = {},
) {
  const errors = [...tokens.errors];
  const warnings = [];
  const allowedNames = new Set([...allowed.neutral, ...allowed.role]);
  const declared = Object.keys(tokens.light);
  const inPairs = new Set(pairs.flatMap(([fg, bg]) => [fg, bg]));

  for (const name of declared) {
    if (!allowedNames.has(name)) {
      errors.push(
        `--color-${name} is outside the spec §10.4 budget. Add it to ALLOWED_TOKENS only with a DECISIONS.md entry.`,
      );
    }
    if (!inPairs.has(name) && !(name in decorative)) {
      errors.push(
        `--color-${name} isn't checked by any contrast pair. Add the pairs it appears in, or mark it decorative.`,
      );
    }
    for (const theme of ['light', 'dark']) {
      if (!isInGamut(tokens[theme][name])) {
        warnings.push(
          `--color-${name} (${theme}) is outside the sRGB gamut; browsers will clip it.`,
        );
      }
    }
  }

  const results = [];
  for (const theme of ['light', 'dark']) {
    for (const [fg, bg, threshold, where] of pairs) {
      const a = tokens[theme][fg];
      const b = tokens[theme][bg];
      if (!a || !b) {
        errors.push(`Pair ${fg} on ${bg} names a token that tokens.css doesn't declare.`);
        continue;
      }
      const ratio = contrastRatio(a, b);
      results.push({ theme, fg, bg, threshold, where, ratio, pass: ratio >= threshold });
    }
  }

  const failures = results.filter((r) => !r.pass).length;
  return { ok: errors.length === 0 && failures === 0, results, errors, warnings, failures };
}

function main() {
  const file =
    process.argv[2] ?? fileURLToPath(new URL('../packages/ui/src/tokens.css', import.meta.url));
  const report = checkTokens(parseTokens(readFileSync(file, 'utf8')));

  for (const theme of ['light', 'dark']) {
    console.log(`\n${theme} theme`);
    for (const r of report.results.filter((x) => x.theme === theme)) {
      console.log(
        `  ${r.pass ? 'PASS' : 'FAIL'}  ${r.ratio.toFixed(2)}:1  (needs ${r.threshold}:1)  ${r.fg} on ${r.bg}: ${r.where}`,
      );
    }
  }
  for (const warning of report.warnings) console.warn(`\nwarning: ${warning}`);
  for (const error of report.errors) console.error(`\nerror: ${error}`);

  console.log(
    report.ok
      ? '\nAll token pairs meet their WCAG 2.1 threshold, and every token is within budget.'
      : `\n${report.failures} pair(s) below threshold, ${report.errors.length} policy error(s).`,
  );
  process.exit(report.ok ? 0 : 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
