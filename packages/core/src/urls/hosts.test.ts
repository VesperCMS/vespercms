import { describe, expect, it } from 'vitest';
import {
  hostRedirects,
  htaccessRules,
  mergeMarkedBlock,
  nginxRules,
  redirectsFileRules,
  vercelRules,
} from './hosts.ts';
import type { UrlSettings } from './pattern.ts';

const settings: UrlSettings = { base: '/', trailingSlash: 'ignore', buildFormat: 'directory' };
const redirects = hostRedirects(
  [
    { from: '/programs/nursing', to: '/academics/nursing', status: 301 },
    { from: '/apply-now', to: '/admissions/apply#steps', status: 302 },
    { from: '/old site', to: 'https://example.org/new', status: 308 },
  ],
  settings,
);

describe('hostRedirects', () => {
  it('sends visitors straight to the page’s canonical URL', () => {
    expect(redirects).toEqual([
      { from: '/programs/nursing', to: '/academics/nursing/', status: 301 },
      { from: '/apply-now', to: '/admissions/apply/#steps', status: 302 },
      { from: '/old site', to: 'https://example.org/new', status: 308 },
    ]);
  });

  it('puts the base on both ends', () => {
    expect(
      hostRedirects([{ from: '/a', to: '/b', status: 301 }], { ...settings, base: '/college/' }),
    ).toEqual([{ from: '/college/a', to: '/college/b/', status: 301 }]);
  });
});

describe('rules per host', () => {
  it('writes forced Netlify rules, and both forms for Cloudflare', () => {
    expect(redirectsFileRules(redirects.slice(0, 2), 'netlify')).toBe(
      '/programs/nursing /academics/nursing/ 301!\n/apply-now /admissions/apply/#steps 302!',
    );
    expect(redirectsFileRules(redirects.slice(0, 1), 'cloudflare')).toBe(
      '/programs/nursing /academics/nursing/ 301\n/programs/nursing/ /academics/nursing/ 301',
    );
  });

  it('writes Apache RedirectMatch lines that match with or without a slash', () => {
    expect(htaccessRules(redirects)).toBe(
      [
        'RedirectMatch 301 ^/programs/nursing/?$ /academics/nursing/',
        'RedirectMatch 302 ^/apply-now/?$ /admissions/apply/#steps',
        'RedirectMatch 308 "^/old site/?$" https://example.org/new',
      ].join('\n'),
    );
  });

  it('writes nginx exact-match locations', () => {
    expect(nginxRules(redirects.slice(0, 1))).toBe(
      [
        'location = /programs/nursing { return 301 /academics/nursing/; }',
        'location = /programs/nursing/ { return 301 /academics/nursing/; }',
      ].join('\n'),
    );
  });

  it('writes Vercel entries', () => {
    expect(vercelRules(redirects.slice(0, 2))).toEqual([
      { source: '/programs/nursing', destination: '/academics/nursing/', permanent: true },
      { source: '/programs/nursing/', destination: '/academics/nursing/', permanent: true },
      { source: '/apply-now', destination: '/admissions/apply/#steps', permanent: false },
      { source: '/apply-now/', destination: '/admissions/apply/#steps', permanent: false },
    ]);
  });
});

describe('mergeMarkedBlock', () => {
  const block = (rules: string) =>
    `# BEGIN vesper\n# Written by Vesper from vesper.redirects.yaml. Edits here are replaced.\n${rules}\n# END vesper\n`;

  it('adds a block to a new file, or at the end of one with other rules', () => {
    expect(mergeMarkedBlock(null, 'A', 'end')).toBe(block('A'));
    expect(mergeMarkedBlock('Options -Indexes', 'A', 'end')).toBe(
      `Options -Indexes\n${block('A')}`,
    );
    expect(mergeMarkedBlock('/* /index.html 200\n', 'A', 'start')).toBe(
      `${block('A')}/* /index.html 200\n`,
    );
  });

  it('replaces only its own block, keeping the rest and its line endings', () => {
    const before = `RewriteEngine On\r\n${block('OLD').replaceAll('\n', '\r\n')}ErrorDocument 404 /404.html\r\n`;
    expect(mergeMarkedBlock(before, 'NEW', 'end')).toBe(
      `RewriteEngine On\r\n${block('NEW').replaceAll('\n', '\r\n')}ErrorDocument 404 /404.html\r\n`,
    );
    expect(mergeMarkedBlock(before, '', 'end')).toBe(
      'RewriteEngine On\r\nErrorDocument 404 /404.html\r\n',
    );
  });
});
