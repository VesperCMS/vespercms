import { gitBlobSha } from '../storage/git-blob-sha.ts';
import { normalizePath } from '../storage/paths.ts';
import type { StorageAdapter, StorageEntry } from '../storage/types.ts';
import { slugify, type ContentService } from './service.ts';
import type { MediaItem, SaveResponse, UploadResponse } from './protocol.ts';

/*
 * The studio's media operations over any storage adapter (spec §6.6): list
 * the site's images and files with where each is used, take uploads into
 * an assets folder, and delete files nothing uses. Upload hygiene (resizing,
 * stripping metadata, sanitizing SVG) runs in the browser before this.
 */

/** File types the studio accepts and shows, by extension. */
export const MEDIA_TYPES: Readonly<Record<string, string>> = {
  avif: 'image/avif',
  gif: 'image/gif',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  png: 'image/png',
  svg: 'image/svg+xml',
  webp: 'image/webp',
  pdf: 'application/pdf',
  mp3: 'audio/mpeg',
  mp4: 'video/mp4',
  webm: 'video/webm',
  csv: 'text/csv',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  zip: 'application/zip',
};

/** Above this, an upload is refused (spec §6.6.6). The browser warns well before it. */
export const UPLOAD_MAX_BYTES = 20 * 1024 * 1024;
/** Above this, the browser asks before uploading. */
export const UPLOAD_WARN_BYTES = 5 * 1024 * 1024;

export function extensionOf(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

export function isImagePath(path: string): boolean {
  return (MEDIA_TYPES[extensionOf(path)] ?? '').startsWith('image/');
}

/** A POSIX path from directory `from` to `to`, both site-relative: `../../assets/a.jpg`. */
export function relativePath(from: string, to: string): string {
  const a = from.split('/').filter(Boolean);
  const b = to.split('/').filter(Boolean);
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  const up = a.slice(i).map(() => '..');
  const rest = b.slice(i);
  const joined = [...up, ...rest].join('/');
  return up.length === 0 ? `./${joined}` : joined;
}

/** The directory part of a site-relative path. */
export function dirOf(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash < 0 ? '' : path.slice(0, slash);
}

/**
 * The site path a value in an entry points at, as Astro resolves it:
 * relative to the entry's file, or `/x` for `public/x`. Aliases and remote
 * URLs return null (the studio can't show them, and leaves them alone).
 */
export function resolveMediaPath(value: string, entryPath: string): string | null {
  if (/^[a-z][a-z0-9+.-]*:/i.test(value) || value.startsWith('//')) return null;
  try {
    if (value.startsWith('/')) return normalizePath(`public${value}`);
    if (value.startsWith('./') || value.startsWith('../')) {
      const parts = dirOf(entryPath).split('/').filter(Boolean);
      for (const segment of value.split('/')) {
        if (segment === '..') parts.pop();
        else if (segment !== '.' && segment !== '') parts.push(segment);
      }
      return normalizePath(parts.join('/'));
    }
  } catch {
    return null;
  }
  return null;
}

/** How an entry at `entryPath` refers to `mediaPath`: relative for assets, `/x` for public files. */
export function mediaReference(mediaPath: string, entryPath: string): string {
  if (mediaPath.startsWith('public/')) return mediaPath.slice('public'.length);
  return relativePath(dirOf(entryPath), mediaPath);
}

export type MediaServiceOptions = {
  /** Folders media lives in, site-relative: `src/assets` and `public` by default. */
  roots?: string[];
};

export class MediaService {
  private readonly storage: StorageAdapter;
  private readonly content: ContentService;
  private readonly roots: string[];

  constructor(storage: StorageAdapter, content: ContentService, options: MediaServiceOptions = {}) {
    this.storage = storage;
    this.content = content;
    this.roots = options.roots ?? ['src/assets', 'public'];
  }

  async list(): Promise<MediaItem[]> {
    const files = await this.files();
    const entries = await this.content.scanEntries();
    const items: MediaItem[] = [];
    for (const file of files) {
      // The version is the git blob SHA, a hash of the bytes: nothing needs reading.
      items.push({
        path: file.path,
        size: file.size,
        hash: file.version,
        version: file.version,
        ...(file.modifiedAt !== undefined ? { modifiedAt: file.modifiedAt } : {}),
        usedBy: entries
          .filter((entry) => mentions(entry.text, file.path, entry.path))
          .map(({ collection, id, title }) => ({ collection, id, title })),
      });
    }
    return items;
  }

  /**
   * Stores an upload in `folder`. A file with the same bytes already there is
   * reused; a different file with the same name gets a numbered name, so an
   * upload never replaces anything.
   */
  async upload(
    bytes: Uint8Array,
    name: string,
    folder: string,
    options: { defer?: boolean } = {},
  ): Promise<UploadResponse> {
    if (bytes.length > UPLOAD_MAX_BYTES) {
      return {
        ok: false,
        message: `That file is larger than ${String(UPLOAD_MAX_BYTES / 1024 / 1024)} MB.`,
      };
    }
    const extension = extensionOf(name);
    if (!MEDIA_TYPES[extension]) {
      return { ok: false, message: `.${extension || '?'} files can’t be uploaded here.` };
    }
    let dir: string;
    try {
      dir = normalizePath(folder);
    } catch {
      return { ok: false, message: 'That folder isn’t inside the site.' };
    }
    const base = slugify(name.slice(0, name.length - extension.length - 1)) || 'file';
    const hash = await gitBlobSha(bytes);
    const taken = new Map((await this.storage.list({ prefix: `${dir}/` })).map((e) => [e.path, e]));
    for (let n = 1; n < 1000; n++) {
      const path = `${dir}/${n === 1 ? base : `${base}-${String(n)}`}.${extension}`;
      const existing = taken.get(path);
      if (existing) {
        if (existing.version === hash) return { ok: true, path, reused: true };
        continue;
      }
      const result = await this.storage.commit({
        changes: [{ op: 'put', path, bytes, expectedVersion: null }],
        message: { summary: `Upload ${path.slice(path.lastIndexOf('/') + 1)}` },
        ...(options.defer ? { defer: true } : {}),
      });
      if (result.ok) return { ok: true, path, reused: false };
      if (result.reason === 'rejected') return { ok: false, message: result.message };
      // Someone wrote that name in the meantime: try the next one.
    }
    return { ok: false, message: 'There are too many files with that name already.' };
  }

  /** Deletes a file that no entry uses. A used file is refused, with where it's used. */
  async remove(path: string): Promise<SaveResponse> {
    const item = (await this.list()).find((m) => m.path === path);
    if (!item) return { ok: false, reason: 'error', message: `${path} wasn’t found.` };
    if (item.usedBy.length > 0) {
      const names = item.usedBy.map((u) => `“${u.title}”`).join(', ');
      return { ok: false, reason: 'error', message: `It’s still used on ${names}.` };
    }
    const result = await this.storage.commit({
      changes: [{ op: 'delete', path, ...(item.version ? { expectedVersion: item.version } : {}) }],
      message: { summary: `Delete ${path.slice(path.lastIndexOf('/') + 1)}` },
    });
    if (result.ok) return { ok: true, id: path, path, version: '', reformatted: false };
    return result.reason === 'conflict'
      ? { ok: false, reason: 'conflict', message: 'The file changed since the list was loaded.' }
      : { ok: false, reason: 'error', message: result.message };
  }

  private async files(): Promise<StorageEntry[]> {
    const found: StorageEntry[] = [];
    for (const root of this.roots) {
      const entries = await this.storage.list({ prefix: `${root}/` });
      found.push(...entries.filter((e) => MEDIA_TYPES[extensionOf(e.path)] !== undefined));
    }
    return found.sort((a, b) => (a.path < b.path ? -1 : 1));
  }
}

/** Whether an entry's text refers to a media file, in any of the ways Astro resolves one. */
function mentions(text: string, mediaPath: string, entryPath: string): boolean {
  const name = mediaPath.slice(mediaPath.lastIndexOf('/') + 1);
  if (!text.includes(name)) return false;
  const reference = mediaReference(mediaPath, entryPath);
  const candidates = [reference, reference.replace(/^\.\//, ''), mediaPath, `/${mediaPath}`];
  // Path aliases such as `~/assets/…` or `@/assets/…` end in the path below src/.
  if (mediaPath.startsWith('src/')) candidates.push(`/${mediaPath.slice('src/'.length)}`);
  return candidates.some((candidate) => text.includes(candidate));
}
