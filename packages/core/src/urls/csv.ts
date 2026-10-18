import { REDIRECT_STATUSES, isExternal, type RedirectStatus } from './redirects.ts';
import { urlKey } from './pattern.ts';

/*
 * CSV import for the Redirects screen (spec §6.15.5), for moving an old
 * site over. It reads three shapes:
 * - plain `from,to[,status]`, with or without a header row;
 * - the WordPress Redirection plugin's export (`source,target,regex,code,…`);
 * - Drupal's Redirect module import format (`source,destination,…,status_code`).
 *
 * Old-site addresses may be absolute (`https://old.example.edu/about-us`):
 * only the path is kept. Rows that can't become a static redirect are
 * skipped, each with a reason in plain words.
 */

export type CsvRedirect = { line: number; from: string; to: string; status: RedirectStatus };
export type CsvProblem = { line: number; message: string };
export type CsvImport = { rows: CsvRedirect[]; problems: CsvProblem[] };

const FROM = [
  'from',
  'source',
  'source url',
  'old',
  'old url',
  'old path',
  'redirect source',
  'redirect_source',
  'url',
];
const TO = [
  'to',
  'target',
  'target url',
  'destination',
  'destination url',
  'new',
  'new url',
  'new path',
  'redirect target',
  'redirect_redirect',
];
const CODE = ['code', 'status_code', 'status code', 'http code', 'http status', 'type', 'status'];
const REGEX = ['regex', 'is_regex', 'is regex'];

export function parseRedirectsCsv(text: string): CsvImport {
  const records = parseCsv(text.startsWith('﻿') ? text.slice(1) : text);
  const rows: CsvRedirect[] = [];
  const problems: CsvProblem[] = [];
  if (records.length === 0) return { rows, problems };

  const first = records[0]?.cells.map((cell) => cell.trim().toLowerCase()) ?? [];
  const hasHeader = first.some((cell) => [...FROM, ...TO].includes(cell));
  const column = (names: readonly string[], fallback: number) => {
    if (!hasHeader) return fallback;
    for (const name of names) {
      const index = first.indexOf(name);
      if (index !== -1) return index;
    }
    return -1;
  };
  const fromAt = column(FROM, 0);
  const toAt = column(TO, 1);
  const codeAt = hasHeader
    ? (CODE.map((name) => first.indexOf(name)).find((i) => i !== -1 && numericColumn(records, i)) ??
      -1)
    : 2;
  const regexAt = column(REGEX, -1);
  // WordPress Redirection's `status` column says whether a redirect is on.
  const enabledAt = hasHeader ? first.indexOf('status') : -1;

  if (fromAt === -1 || toAt === -1) {
    return {
      rows,
      problems: [
        {
          line: 1,
          message:
            'The first row has column names, but none for the old and new addresses. Name them "from" and "to".',
        },
      ],
    };
  }

  for (const record of records.slice(hasHeader ? 1 : 0)) {
    const cell = (index: number) => (index === -1 ? '' : (record.cells[index] ?? '').trim());
    if (record.cells.every((c) => c.trim() === '')) continue;
    const line = record.line;
    if (
      enabledAt !== -1 &&
      enabledAt !== codeAt &&
      /^(disabled|inactive|off)$/i.test(cell(enabledAt))
    ) {
      problems.push({ line, message: 'Turned off in the export, so it was skipped.' });
      continue;
    }
    if (regexAt !== -1 && /^(1|true|yes)$/i.test(cell(regexAt))) {
      problems.push({
        line,
        message: 'Pattern redirects can’t be imported. Add the addresses it covers one by one.',
      });
      continue;
    }
    const from = oldPath(cell(fromAt));
    if (!from.ok) {
      problems.push({ line, message: from.message });
      continue;
    }
    const to = newAddress(cell(toAt));
    if (!to.ok) {
      problems.push({ line, message: to.message });
      continue;
    }
    const code = cell(codeAt);
    const status = code === '' ? 301 : Number(code);
    if (!REDIRECT_STATUSES.includes(status as RedirectStatus)) {
      problems.push({
        line,
        message: `Only redirects can be imported (301, 302, 303, 307 or 308). This row has ${code}.`,
      });
      continue;
    }
    if (from.key === to.value) {
      problems.push({ line, message: `${from.key} would redirect to itself.` });
      continue;
    }
    rows.push({ line, from: from.key, to: to.value, status: status as RedirectStatus });
  }
  return { rows, problems };
}

function oldPath(raw: string): { ok: true; key: string } | { ok: false; message: string } {
  if (raw === '') return { ok: false, message: 'The old address is empty.' };
  let path = raw;
  const absolute = /^[a-z][a-z\d+.-]*:\/\/[^/?#]*/i.exec(raw);
  if (absolute) path = raw.slice(absolute[0].length) || '/';
  else if (!path.startsWith('/')) path = `/${path}`;
  if (/[?]/.test(path.replace(/#.*$/, ''))) {
    return {
      ok: false,
      message: `${raw} has a query (?…). A static site can’t tell those addresses apart, so it was skipped.`,
    };
  }
  const key = urlKey(path);
  if (key === null) return { ok: false, message: `${raw} isn’t an address on a site.` };
  if (key === '/') return { ok: false, message: 'The home page can’t be redirected.' };
  return { ok: true, key };
}

function newAddress(raw: string): { ok: true; value: string } | { ok: false; message: string } {
  if (raw === '') return { ok: false, message: 'The new address is empty.' };
  if (isExternal(raw)) {
    return /^https?:\/\//i.test(raw)
      ? { ok: true, value: raw }
      : { ok: false, message: `${raw} isn’t a web address.` };
  }
  const path = raw.startsWith('/') ? raw : `/${raw}`;
  const cut = path.search(/[?#]/);
  const key = urlKey(cut === -1 ? path : path.slice(0, cut));
  return key === null
    ? { ok: false, message: `${raw} isn’t an address on this site.` }
    : { ok: true, value: key + (cut === -1 ? '' : path.slice(cut)) };
}

function numericColumn(records: readonly CsvRecord[], index: number): boolean {
  const values = records
    .slice(1)
    .map((r) => (r.cells[index] ?? '').trim())
    .filter((v) => v !== '');
  return values.length === 0 || values.every((v) => /^\d{3}$/.test(v));
}

type CsvRecord = { line: number; cells: string[] };

/** RFC 4180: commas, double-quoted fields with `""` escapes and line breaks inside quotes. Also reads `;` and tab-separated files. */
export function parseCsv(text: string): CsvRecord[] {
  const delimiter = detectDelimiter(text);
  const records: CsvRecord[] = [];
  let cells: string[] = [];
  let cell = '';
  let quoted = false;
  let line = 1;
  let recordLine = 1;
  for (let i = 0; i < text.length; i++) {
    const char = text.charAt(i);
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (char === '"') {
        quoted = false;
      } else {
        if (char === '\n') line++;
        cell += char;
      }
    } else if (char === '"' && cell.trim() === '') {
      quoted = true;
      cell = '';
    } else if (char === delimiter) {
      cells.push(cell);
      cell = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i++;
      cells.push(cell);
      records.push({ line: recordLine, cells });
      cells = [];
      cell = '';
      line++;
      recordLine = line;
    } else {
      cell += char;
    }
  }
  if (cell !== '' || cells.length > 0) {
    cells.push(cell);
    records.push({ line: recordLine, cells });
  }
  return records;
}

function detectDelimiter(text: string): string {
  const header = text.split(/\r?\n/, 1)[0] ?? '';
  const counts = [',', ';', '\t'].map((d) => [d, header.split(d).length - 1] as const);
  const best = counts.reduce((a, b) => (b[1] > a[1] ? b : a));
  return best[1] > 0 ? best[0] : ',';
}
