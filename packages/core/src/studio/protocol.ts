import { isPlainObject, type DataObject, type DataValue } from '../files/equal.ts';

/*
 * The studio's API contract (spec §6.7): what the /admin app and a storage
 * back end (local dev middleware now, GitHub and cloud later) send each
 * other. Plain JSON, with Dates carried as `{ "$date": "<ISO>" }` so a date
 * survives the round trip as a Date, and the writer can keep its shape.
 */

const DATE_KEY = '$date';

/** JSON-safe form of a parsed value: Dates become `{ $date: iso }`. */
export function encodeValue(value: DataValue): unknown {
  if (value instanceof Date) return { [DATE_KEY]: value.toISOString() };
  if (Array.isArray(value)) return value.map(encodeValue);
  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => [k, encodeValue(v)]),
    );
  }
  return value;
}

/** Reverses `encodeValue`. */
export function decodeValue(value: unknown): DataValue {
  if (Array.isArray(value)) return value.map(decodeValue);
  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record);
    if (keys.length === 1 && keys[0] === DATE_KEY && typeof record[DATE_KEY] === 'string') {
      return new Date(record[DATE_KEY]);
    }
    return Object.fromEntries(Object.entries(record).map(([k, v]) => [k, decodeValue(v)]));
  }
  return value as DataValue;
}

export type EntryStatus = 'editable' | 'source-only' | 'read-only';

export type EntryFormat = 'md' | 'mdx' | 'mdoc' | 'json' | 'yaml';

/** One row of a collection's entry list. */
export type EntrySummary = {
  id: string;
  /** Site-relative POSIX path of the file that holds the entry. */
  path: string;
  title: string;
  status: EntryStatus;
  /** Encoded values of the collection's list fields (`presentation.listFields`). */
  fields: Record<string, unknown>;
  /** Last change time of the file, ISO 8601, when the back end knows it. */
  updatedAt?: string;
  /** `true` when the entry's data says it's a draft (`draft: true`). */
  draft?: boolean;
};

/** One row of the home screen (spec §10.3): entry count and last edit per collection. */
export type CollectionSummary = {
  collection: string;
  count: number;
  /** The newest entry file's change time, ISO 8601, when the back end knows it. */
  updatedAt?: string;
};

export type EntryDocument = {
  collection: string;
  id: string;
  path: string;
  /** Git blob SHA of the file when it was read. Sent back on save to detect conflicts. */
  version: string;
  format: EntryFormat;
  status: EntryStatus;
  /** Plain-language reason for `source-only` or `read-only`. */
  message?: string;
  /** Encoded values (see `encodeValue`). For source-only entries, best-effort display values. */
  data: unknown;
  /** Body text for Markdown-family entries. */
  body?: string;
  /** The raw frontmatter text, for source-only entries edited as YAML. */
  rawFrontmatter?: string;
};

export type SaveRequest = {
  collection: string;
  id: string;
  /** The version the edit started from; `null` to create a new entry. */
  version: string | null;
  data?: unknown;
  body?: string;
  /** New entries only: the file name or path pattern inside the collection, without extension. */
  slug?: string;
};

export type FieldIssue = { path: (string | number)[]; message: string };

export type SaveResponse =
  | { ok: true; id: string; path: string; version: string; reformatted: boolean }
  | { ok: false; reason: 'invalid'; issues: FieldIssue[] }
  | { ok: false; reason: 'conflict'; message: string }
  | { ok: false; reason: 'error'; message: string };

export type MediaItem = {
  /** Site-relative POSIX path. */
  path: string;
  size: number;
  /** SHA-256 of the file's bytes, for duplicate detection on upload (spec §6.6.6). */
  hash: string;
  /** Entries whose files mention this path ("Used on"). */
  usedBy: { collection: string; id: string; title: string }[];
};

export type UploadResponse =
  { ok: true; path: string; reused: boolean } | { ok: false; message: string };

/** Decodes an entry's data as an object (an empty object when it isn't one). */
export function decodeData(value: unknown): DataObject {
  const decoded = decodeValue(value);
  return isPlainObject(decoded) ? decoded : {};
}
