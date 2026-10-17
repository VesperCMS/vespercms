/*
 * Just enough of each image format to make upload hygiene decisions without
 * decoding pixels (spec §6.6.6): what a file really is, its size, its EXIF
 * orientation, whether it carries location data, and how to drop metadata
 * without re-encoding. Pure functions over bytes, so they're unit-tested.
 */

export type DetectedType =
  'jpeg' | 'png' | 'gif' | 'webp' | 'avif' | 'heic' | 'svg' | 'pdf' | 'other';

const ascii = (bytes: Uint8Array, start: number, length: number) =>
  String.fromCharCode(...bytes.subarray(start, start + length));

/** What a file is, from its first bytes rather than its name. */
export function detectType(bytes: Uint8Array): DetectedType {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';
  if (ascii(bytes, 0, 8) === '\x89PNG\r\n\x1a\n') return 'png';
  if (ascii(bytes, 0, 4) === 'GIF8') return 'gif';
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') return 'webp';
  if (ascii(bytes, 0, 5) === '%PDF-') return 'pdf';
  if (ascii(bytes, 4, 4) === 'ftyp') {
    const size = view(bytes).getUint32(0);
    const brands = [ascii(bytes, 8, 4)];
    for (let at = 16; at + 4 <= Math.min(size, bytes.length); at += 4)
      brands.push(ascii(bytes, at, 4));
    if (brands.some((b) => b === 'avif' || b === 'avis')) return 'avif';
    if (
      brands.some((b) =>
        ['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1'].includes(b),
      )
    ) {
      return 'heic';
    }
  }
  const head = new TextDecoder()
    .decode(bytes.subarray(0, 1024))
    .replace(/^\uFEFF/, '')
    .trimStart();
  if (/^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE svg[^>]*>\s*)?<svg[\s>]/i.test(head))
    return 'svg';
  return 'other';
}

function view(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

export type ImageFacts = {
  width?: number;
  height?: number;
  /** EXIF orientation, 1–8. 1 (or absent) means the pixels are already upright. */
  orientation?: number;
  /** EXIF GPS data is present. */
  hasLocation: boolean;
  /** Any metadata a lossless strip would remove. */
  hasMetadata: boolean;
};

// --- JPEG -----------------------------------------------------------------

type Segment = { marker: number; start: number; end: number };

/** Segments before the image data (SOS), with their byte ranges. */
function jpegSegments(bytes: Uint8Array): { segments: Segment[]; dataStart: number } {
  const segments: Segment[] = [];
  let at = 2;
  while (at + 4 <= bytes.length && bytes[at] === 0xff) {
    const marker = bytes[at + 1] ?? 0;
    if (marker === 0xff) {
      at += 1; // fill byte
      continue;
    }
    const length = view(bytes).getUint16(at + 2);
    const end = at + 2 + length;
    if (marker === 0xda) return { segments, dataStart: at };
    segments.push({ marker, start: at, end });
    at = end;
  }
  return { segments, dataStart: at };
}

/** Orientation and GPS presence from an EXIF (TIFF) block. */
function readExif(tiff: Uint8Array): { orientation?: number; hasLocation: boolean } {
  if (tiff.length < 8) return { hasLocation: false };
  const little = ascii(tiff, 0, 2) === 'II';
  const data = view(tiff);
  const u16 = (o: number) => data.getUint16(o, little);
  const u32 = (o: number) => data.getUint32(o, little);
  const ifd = u32(4);
  if (ifd + 2 > tiff.length) return { hasLocation: false };
  let orientation: number | undefined;
  let hasLocation = false;
  const count = u16(ifd);
  for (let i = 0; i < count; i++) {
    const entry = ifd + 2 + i * 12;
    if (entry + 12 > tiff.length) break;
    const tag = u16(entry);
    if (tag === 0x0112) orientation = u16(entry + 8);
    if (tag === 0x8825) hasLocation = true;
  }
  return { ...(orientation !== undefined ? { orientation } : {}), hasLocation };
}

const KEEP_APP = new Set([0xe0, 0xe2, 0xee]); // JFIF, ICC colour profile, Adobe colour transform

export function jpegFacts(bytes: Uint8Array): ImageFacts {
  const facts: ImageFacts = { hasLocation: false, hasMetadata: false };
  for (const s of jpegSegments(bytes).segments) {
    const body = bytes.subarray(s.start + 4, s.end);
    if (s.marker === 0xe1 && ascii(body, 0, 6) === 'Exif\0\0') {
      Object.assign(facts, readExif(body.subarray(6)));
    }
    if ((s.marker >= 0xe1 && s.marker <= 0xef && !KEEP_APP.has(s.marker)) || s.marker === 0xfe) {
      facts.hasMetadata = true;
    }
    // Start-of-frame markers carry the size (not DHT C4, JPG C8 or DAC CC).
    if (s.marker >= 0xc0 && s.marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(s.marker)) {
      facts.height = view(bytes).getUint16(s.start + 5);
      facts.width = view(bytes).getUint16(s.start + 7);
    }
  }
  return facts;
}

/** The same JPEG without EXIF, XMP, IPTC or comments. The image data is untouched. */
export function stripJpeg(bytes: Uint8Array): Uint8Array {
  const { segments, dataStart } = jpegSegments(bytes);
  const parts: Uint8Array[] = [bytes.subarray(0, 2)];
  for (const s of segments) {
    const metadata =
      (s.marker >= 0xe1 && s.marker <= 0xef && !KEEP_APP.has(s.marker)) || s.marker === 0xfe;
    if (!metadata) parts.push(bytes.subarray(s.start, s.end));
  }
  parts.push(bytes.subarray(dataStart));
  return concat(parts);
}

// --- PNG ------------------------------------------------------------------

const PNG_METADATA = new Set(['eXIf', 'tEXt', 'iTXt', 'zTXt', 'tIME']);

function pngChunks(bytes: Uint8Array): { type: string; start: number; end: number }[] {
  const chunks: { type: string; start: number; end: number }[] = [];
  let at = 8;
  while (at + 12 <= bytes.length) {
    const length = view(bytes).getUint32(at);
    const type = ascii(bytes, at + 4, 4);
    const end = at + 12 + length;
    chunks.push({ type, start: at, end });
    at = end;
    if (type === 'IEND') break;
  }
  return chunks;
}

export function pngFacts(bytes: Uint8Array): ImageFacts {
  const chunks = pngChunks(bytes);
  const ihdr = chunks.find((c) => c.type === 'IHDR');
  const exif = chunks.find((c) => c.type === 'eXIf');
  return {
    ...(ihdr
      ? {
          width: view(bytes).getUint32(ihdr.start + 8),
          height: view(bytes).getUint32(ihdr.start + 12),
        }
      : {}),
    ...(exif ? readExif(bytes.subarray(exif.start + 8, exif.end - 4)) : { hasLocation: false }),
    hasMetadata: chunks.some((c) => PNG_METADATA.has(c.type)),
  };
}

/** The same PNG without text, time or EXIF chunks. */
export function stripPng(bytes: Uint8Array): Uint8Array {
  const parts = [bytes.subarray(0, 8)];
  for (const c of pngChunks(bytes)) {
    if (!PNG_METADATA.has(c.type)) parts.push(bytes.subarray(c.start, c.end));
  }
  return concat(parts);
}

// --- WebP -----------------------------------------------------------------

function webpChunks(bytes: Uint8Array): { type: string; start: number; end: number }[] {
  const chunks: { type: string; start: number; end: number }[] = [];
  let at = 12;
  while (at + 8 <= bytes.length) {
    const size = view(bytes).getUint32(at + 4, true);
    const end = at + 8 + size + (size % 2);
    chunks.push({ type: ascii(bytes, at, 4), start: at, end: Math.min(end, bytes.length) });
    at = end;
  }
  return chunks;
}

export function webpFacts(bytes: Uint8Array): ImageFacts {
  const chunks = webpChunks(bytes);
  const data = view(bytes);
  const facts: ImageFacts = {
    hasLocation: false,
    hasMetadata: chunks.some((c) => c.type === 'EXIF' || c.type === 'XMP '),
  };
  const exif = chunks.find((c) => c.type === 'EXIF');
  if (exif) {
    let tiff = bytes.subarray(exif.start + 8, exif.end);
    if (ascii(tiff, 0, 6) === 'Exif\0\0') tiff = tiff.subarray(6);
    Object.assign(facts, readExif(tiff));
  }
  for (const c of chunks) {
    const d = c.start + 8;
    if (c.type === 'VP8X') {
      facts.width = 1 + (data.getUint32(d + 4, true) & 0xffffff);
      facts.height = 1 + (data.getUint32(d + 7, true) & 0xffffff);
      break;
    }
    if (c.type === 'VP8 ') {
      facts.width = data.getUint16(d + 6, true) & 0x3fff;
      facts.height = data.getUint16(d + 8, true) & 0x3fff;
      break;
    }
    if (c.type === 'VP8L') {
      const bits = data.getUint32(d + 1, true);
      facts.width = 1 + (bits & 0x3fff);
      facts.height = 1 + ((bits >> 14) & 0x3fff);
      break;
    }
  }
  return facts;
}

/** The same WebP without EXIF or XMP, with the header flags and size fixed up. */
export function stripWebp(bytes: Uint8Array): Uint8Array {
  const parts: Uint8Array[] = [];
  for (const c of webpChunks(bytes)) {
    if (c.type === 'EXIF' || c.type === 'XMP ') continue;
    const chunk = bytes.slice(c.start, c.end);
    if (c.type === 'VP8X') chunk[8] = (chunk[8] ?? 0) & ~(0x08 | 0x04);
    parts.push(chunk);
  }
  const body = concat(parts);
  const out = new Uint8Array(12 + body.length);
  out.set(bytes.subarray(0, 12));
  out.set(body, 12);
  new DataView(out.buffer).setUint32(4, out.length - 8, true);
  return out;
}

export function imageFacts(type: DetectedType, bytes: Uint8Array): ImageFacts {
  if (type === 'jpeg') return jpegFacts(bytes);
  if (type === 'png') return pngFacts(bytes);
  if (type === 'webp') return webpFacts(bytes);
  return { hasLocation: false, hasMetadata: false };
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}
