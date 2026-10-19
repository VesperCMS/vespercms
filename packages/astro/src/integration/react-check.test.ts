import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { reactProblem, reactVersionFrom } from './react-check.ts';

describe('the React check', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  function site(version: string | null): string {
    const dir = mkdtempSync(join(tmpdir(), 'vesper-react-'));
    dirs.push(dir);
    if (version !== null) {
      mkdirSync(join(dir, 'node_modules/react'), { recursive: true });
      writeFileSync(
        join(dir, 'node_modules/react/package.json'),
        JSON.stringify({ name: 'react', version }),
      );
    }
    return join(dir, 'index.js');
  }

  it('reads the React a file resolves', () => {
    expect(reactVersionFrom(site('18.3.1'))).toBe('18.3.1');
    expect(reactVersionFrom(site(null))).toBeNull();
  });

  it('accepts React 19 and later', () => {
    expect(reactProblem('19.0.0')).toBeNull();
    expect(reactProblem('19.3.0-canary-1')).toBeNull();
    expect(reactProblem('20.1.0')).toBeNull();
  });

  it('says plainly what to do about React 18, or none', () => {
    expect(reactProblem('18.3.1')).toBe(
      "Vesper's studio needs React 19, and this site has React 18.3.1. Install React 19 with `npm install react@19 react-dom@19`, then restart.",
    );
    expect(reactProblem(null)).toMatch(
      /^Vesper's studio needs React 19, and this site has no React\./,
    );
  });

  it('finds React 19 from the studio in this workspace', () => {
    expect(reactProblem(reactVersionFrom(import.meta.resolve('@vesper/admin')))).toBeNull();
  });
});
