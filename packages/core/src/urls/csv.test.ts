import { describe, expect, it } from 'vitest';
import { parseCsv, parseRedirectsCsv } from './csv.ts';

describe('parseCsv', () => {
  it('reads quoted fields with commas, quotes and line breaks', () => {
    expect(parseCsv('a,"b, c","say ""hi"""\r\n"multi\nline",x\n')).toEqual([
      { line: 1, cells: ['a', 'b, c', 'say "hi"'] },
      { line: 2, cells: ['multi\nline', 'x'] },
    ]);
  });

  it('reads semicolon-separated files', () => {
    expect(parseCsv('from;to\n/a;/b')).toEqual([
      { line: 1, cells: ['from', 'to'] },
      { line: 2, cells: ['/a', '/b'] },
    ]);
  });
});

describe('parseRedirectsCsv', () => {
  it('reads plain rows with no header, defaulting to 301', () => {
    expect(parseRedirectsCsv('/about-us,/about\nold-page,/academics/,302\n')).toEqual({
      rows: [
        { line: 1, from: '/about-us', to: '/about', status: 301 },
        { line: 2, from: '/old-page', to: '/academics', status: 302 },
      ],
      problems: [],
    });
  });

  it('reads a WordPress Redirection export, skipping patterns and turned-off rows', () => {
    const csv = [
      'source,target,regex,code,type,hits,title,status',
      'https://old.example.edu/about-us/,/about,0,301,url,12,,enabled',
      '/news/(.*),/blog/$1,1,301,url,4,,enabled',
      '/retired,/about,0,301,url,0,,disabled',
      '/gone,/about,0,410,url,0,,enabled',
    ].join('\n');
    expect(parseRedirectsCsv(csv)).toEqual({
      rows: [{ line: 2, from: '/about-us', to: '/about', status: 301 }],
      problems: [
        {
          line: 3,
          message: 'Pattern redirects can’t be imported. Add the addresses it covers one by one.',
        },
        { line: 4, message: 'Turned off in the export, so it was skipped.' },
        {
          line: 5,
          message: 'Only redirects can be imported (301, 302, 303, 307 or 308). This row has 410.',
        },
      ],
    });
  });

  it('reads Drupal’s import format and explains rows it can’t use', () => {
    const csv = [
      'source,destination,language,status_code',
      'node/12,/academics/nursing,en,301',
      '?p=12,/about,und,301',
      '/,/about,und,301',
      'old,,und,301',
      '/same,/same/,und,301',
    ].join('\n');
    const result = parseRedirectsCsv(csv);
    expect(result.rows).toEqual([
      { line: 2, from: '/node/12', to: '/academics/nursing', status: 301 },
    ]);
    expect(result.problems.map((p) => [p.line, p.message])).toEqual([
      [
        3,
        '?p=12 has a query (?…). A static site can’t tell those addresses apart, so it was skipped.',
      ],
      [4, 'The home page can’t be redirected.'],
      [5, 'The new address is empty.'],
      [6, '/same would redirect to itself.'],
    ]);
  });

  it('keeps external targets and the hash of internal ones', () => {
    expect(
      parseRedirectsCsv('from,to\n/a,https://example.org/x\n/b,/admissions/apply/#steps').rows,
    ).toEqual([
      { line: 2, from: '/a', to: 'https://example.org/x', status: 301 },
      { line: 3, from: '/b', to: '/admissions/apply#steps', status: 301 },
    ]);
  });

  it('asks for column names it can recognize', () => {
    expect(parseRedirectsCsv('url,destination\n').problems).toEqual([]);
    expect(parseRedirectsCsv('name,address\n/a,/b').rows).toEqual([
      { line: 1, from: '/name', to: '/address', status: 301 },
      { line: 2, from: '/a', to: '/b', status: 301 },
    ]);
  });
});
