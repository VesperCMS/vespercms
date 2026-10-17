import type { MediaItem } from '@vesper/core';
import type { StudioApi } from '../app/api.ts';
import { prepareUpload, type HygieneOptions, type PreparedUpload } from './hygiene.ts';

/*
 * The upload flow shared by the image field, the file field and the media
 * browser: hygiene, then a duplicate check against the site's files by
 * content hash (spec §6.6.6), then the upload itself.
 */

export type UploadStep =
  | { step: 'refused'; message: string }
  /** The same bytes are already in the site: reuse that file, or upload a copy. */
  | { step: 'duplicate'; upload: PreparedUpload; existing: string }
  /** Large after processing: the editor confirms first. */
  | { step: 'confirm-large'; upload: PreparedUpload }
  | { step: 'ready'; upload: PreparedUpload };

export async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function checkUpload(
  file: File,
  media: readonly MediaItem[],
  options: HygieneOptions,
): Promise<UploadStep> {
  const prepared = await prepareUpload(file, options);
  if (!prepared.ok) return { step: 'refused', message: prepared.message };
  const hash = await sha256(prepared.upload.bytes);
  const existing = media.find((item) => item.hash === hash);
  if (existing) return { step: 'duplicate', upload: prepared.upload, existing: existing.path };
  if (prepared.upload.large) return { step: 'confirm-large', upload: prepared.upload };
  return { step: 'ready', upload: prepared.upload };
}

export async function sendUpload(
  api: StudioApi,
  upload: PreparedUpload,
  folder: string,
): Promise<{ ok: true; path: string } | { ok: false; message: string }> {
  const result = await api.upload(new Blob([upload.bytes as BlobPart]), upload.name, folder);
  return result.ok ? { ok: true, path: result.path } : result;
}
