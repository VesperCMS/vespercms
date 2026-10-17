import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { checkTokens, contrastRatio, parseTokens } from './a11y-contrast.mjs';

const tokensCss = readFileSync(new URL('../packages/ui/src/tokens.css', import.meta.url), 'utf8');

function theme(declarations) {
  return `@theme {\n  --color-*: initial;\n${declarations}\n}\n`;
}

describe('contrastRatio', () => {
  it('gives 21:1 for white on black and 1:1 for identical colours', () => {
    expect(contrastRatio([100, 0, 0], [0, 0, 0])).toBeCloseTo(21, 1);
    expect(contrastRatio([50, 0.1, 250], [50, 0.1, 250])).toBeCloseTo(1, 5);
  });
});

describe('parseTokens', () => {
  it('reads both halves of each light-dark pair and ignores comments', () => {
    const tokens = parseTokens(
      theme(
        '  /* --color-ghost: red; */\n  --color-accent: light-dark(oklch(50% 0.16 270), oklch(76% 0.12 270));',
      ),
    );
    expect(tokens.errors).toEqual([]);
    expect(tokens.light.accent).toEqual([50, 0.16, 270]);
    expect(tokens.dark.accent).toEqual([76, 0.12, 270]);
    expect(tokens.light.ghost).toBeUndefined();
  });

  it.each([
    ['alpha', 'light-dark(oklch(50% 0.1 250 / 0.5), oklch(70% 0.1 250))'],
    ['hex', '#1a73e8'],
    ['a single oklch value', 'oklch(50% 0.1 250)'],
  ])('rejects %s', (_label, value) => {
    expect(parseTokens(theme(`  --color-accent: ${value};`)).errors).toHaveLength(1);
  });

  it('rejects colour tokens redefined outside @theme', () => {
    const css = `${theme('  --color-accent: light-dark(oklch(50% 0.16 270), oklch(76% 0.12 270));')}\nhtml[data-theme='dark'] { --color-accent: red; }`;
    expect(parseTokens(css).errors.join()).toMatch(/outside @theme/);
  });
});

describe('checkTokens', () => {
  const pairs = [['content', 'surface', 4.5, 'body text']];
  const allowed = { neutral: ['content', 'surface'], role: [] };
  const passing = theme(
    [
      '  --color-surface: light-dark(oklch(99% 0 0), oklch(20% 0 0));',
      '  --color-content: light-dark(oklch(24% 0 0), oklch(95% 0 0));',
    ].join('\n'),
  );

  it('passes a well-formed, high-contrast token set', () => {
    expect(checkTokens(parseTokens(passing), { pairs, allowed, decorative: {} }).ok).toBe(true);
  });

  it('fails a pair below its threshold in either theme', () => {
    const lowDark = passing.replace('oklch(95% 0 0)', 'oklch(30% 0 0)');
    const report = checkTokens(parseTokens(lowDark), { pairs, allowed, decorative: {} });
    expect(report.ok).toBe(false);
    expect(report.results.filter((r) => !r.pass).map((r) => r.theme)).toEqual(['dark']);
  });

  it('fails a token outside the budget allowlist', () => {
    const extra = passing.replace(
      '--color-*: initial;',
      '--color-*: initial;\n  --color-ai: light-dark(oklch(48% 0.2 300), oklch(76% 0.15 300));',
    );
    const report = checkTokens(parseTokens(extra), { pairs, allowed, decorative: {} });
    expect(report.errors.join()).toMatch(/--color-ai is outside the spec §10.4 budget/);
  });

  it('fails an allowed token that no pair checks, unless it is marked decorative', () => {
    const withBorder = passing.replace(
      '--color-*: initial;',
      '--color-*: initial;\n  --color-border: light-dark(oklch(90% 0 0), oklch(33% 0 0));',
    );
    const widened = { neutral: [...allowed.neutral, 'border'], role: [] };
    expect(
      checkTokens(parseTokens(withBorder), { pairs, allowed: widened, decorative: {} }).ok,
    ).toBe(false);
    expect(
      checkTokens(parseTokens(withBorder), {
        pairs,
        allowed: widened,
        decorative: { border: 'separators' },
      }).ok,
    ).toBe(true);
  });

  it('fails a pair that names an undeclared token', () => {
    const report = checkTokens(parseTokens(passing), {
      pairs: [['content', 'surface-raised', 4.5, 'cards']],
      allowed,
      decorative: {},
    });
    expect(report.errors.join()).toMatch(/doesn't declare/);
  });
});

describe('packages/ui/src/tokens.css', () => {
  it('meets every contrast pair and stays within the design budget', () => {
    const report = checkTokens(parseTokens(tokensCss));
    expect(report.errors).toEqual([]);
    expect(report.results.filter((r) => !r.pass)).toEqual([]);
    expect(report.warnings).toEqual([]);
  });
});
