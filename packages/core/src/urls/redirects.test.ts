import { describe, expect, it } from 'vitest';
import { calendarDate, cleanRedirects, withMoveRedirects, type Redirect } from './redirects.ts';

const pages = new Set(['/', '/academics', '/academics/nursing', '/admissions/apply', '/nursing']);
const isPage = (key: string) => pages.has(key);
const r = (from: string, to: string, status: Redirect['status'] = 301): Redirect => ({
  from,
  to,
  status,
});

describe('cleanRedirects', () => {
  it('collapses chains onto their final address', () => {
    const { redirects, warnings } = cleanRedirects(
      [
        r('/programs/nursing', '/academics/nursing-old'),
        r('/academics/nursing-old', '/academics/nursing'),
        r('/apply-now', '/admissions/apply', 302),
      ],
      { isPage },
    );
    expect(redirects).toEqual([
      r('/programs/nursing', '/academics/nursing'),
      r('/academics/nursing-old', '/academics/nursing'),
      r('/apply-now', '/admissions/apply', 302),
    ]);
    expect(warnings).toEqual([]);
  });

  it('makes a collapsed redirect temporary when any hop was', () => {
    const { redirects } = cleanRedirects(
      [
        r('/a', '/b'),
        r('/b', '/c', 302),
        r('/c', '/nursing'),
        r('/x', '/y', 308),
        r('/y', '/z', 307),
      ],
      { isPage: (key) => key === '/nursing' || key === '/z' },
    );
    expect(redirects.map((x) => [x.from, x.to, x.status])).toEqual([
      ['/a', '/nursing', 302],
      ['/b', '/nursing', 302],
      ['/c', '/nursing', 301],
      ['/x', '/z', 307],
      ['/y', '/z', 307],
    ]);
  });

  it('removes loops, including a redirect to itself', () => {
    const { redirects, warnings } = cleanRedirects(
      [r('/a', '/b'), r('/b', '/a/'), r('/self', '/self'), r('/c', '/a'), r('/ok', '/academics')],
      { isPage },
    );
    expect(redirects.map((x) => x.from)).toEqual(['/c', '/ok']);
    expect(warnings.filter((w) => w.kind === 'loop').map((w) => w.from)).toEqual([
      '/a',
      '/b',
      '/self',
    ]);
    // /c now leads to an address that's neither a page nor a redirect.
    expect(warnings.find((w) => w.kind === 'missing-target')?.from).toBe('/c');
  });

  it('drops a redirect whose old address is a real page again', () => {
    const { redirects, warnings } = cleanRedirects(
      [r('/academics/nursing', '/nursing'), r('/programs', '/academics/nursing')],
      { isPage },
    );
    expect(redirects).toEqual([r('/programs', '/academics/nursing')]);
    expect(warnings).toEqual([
      expect.objectContaining({
        kind: 'onto-page',
        message: '/academics/nursing is a page again, so its redirect to /nursing was removed.',
      }),
    ]);
  });

  it('keeps the later of two redirects from the same address', () => {
    const { redirects, warnings } = cleanRedirects([r('/a', '/academics'), r('/a/', '/nursing')], {
      isPage,
    });
    expect(redirects).toEqual([r('/a/', '/nursing')]);
    expect(warnings.map((w) => w.kind)).toEqual(['duplicate']);
  });

  it('flags a target that leads nowhere, and leaves external targets alone', () => {
    const { redirects, warnings } = cleanRedirects(
      [r('/gone', '/nowhere'), r('/old-site', 'https://example.org/new')],
      { isPage },
    );
    expect(redirects).toHaveLength(2);
    expect(warnings).toEqual([
      expect.objectContaining({
        kind: 'missing-target',
        message: '/gone redirects to /nowhere, which isn’t a page on this site.',
      }),
    ]);
  });

  it('keeps entries it can’t read, untouched, with a warning', () => {
    const odd = { from: 'no-slash', to: '/a', note: 'hand-written' };
    const { redirects, warnings } = cleanRedirects([odd, r('/b', '/academics')], { isPage });
    expect(redirects[0]).toBe(odd);
    expect(warnings[0]?.kind).toBe('invalid');
  });

  it('keeps other keys on each redirect', () => {
    const entry = { ...r('/a', '/b'), reason: 'move', at: '2026-10-01', note: 'kept' };
    const { redirects } = cleanRedirects([entry, r('/b', '/academics')], { isPage });
    expect(redirects[0]).toEqual({ ...entry, to: '/academics' });
  });
});

describe('withMoveRedirects', () => {
  it('adds a dated move redirect per page, replacing one from the same address', () => {
    const at = new Date('2026-10-18T15:00:00Z');
    const list = withMoveRedirects(
      [r('/academics/nursing', '/somewhere'), r('/apply-now', '/admissions/apply', 302)],
      [
        { from: '/academics/nursing', to: '/nursing' },
        { from: '/academics/nursing/rn-to-bsn', to: '/nursing/rn-to-bsn' },
      ],
      at,
    );
    expect(list).toEqual([
      r('/apply-now', '/admissions/apply', 302),
      { ...r('/academics/nursing', '/nursing'), reason: 'move', at: new Date('2026-10-18') },
      {
        ...r('/academics/nursing/rn-to-bsn', '/nursing/rn-to-bsn'),
        reason: 'move',
        at: new Date('2026-10-18'),
      },
    ]);
  });

  it('dates by the site’s calendar', () => {
    const lateEvening = new Date('2026-10-19T02:00:00Z');
    expect(calendarDate(lateEvening, 'America/New_York')).toEqual(new Date('2026-10-18'));
    expect(calendarDate(lateEvening)).toEqual(new Date('2026-10-19'));
  });
});
