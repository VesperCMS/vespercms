import { UPLOAD_MAX_BYTES, UPLOAD_WARN_BYTES } from '@vesper/core';
import DOMPurify from 'dompurify';
import {
  detectType,
  imageFacts,
  stripJpeg,
  stripPng,
  stripWebp,
  type DetectedType,
} from './formats.ts';

/*
 * Upload hygiene (spec §6.6.6), in the browser, before anything is saved:
 * - photos larger than `maxEdge` are scaled down;
 * - EXIF orientation is applied to the pixels, then location and other
 *   personal metadata are removed (losslessly when the pixels don't change);
 * - HEIC photos become JPEG where the browser can decode them;
 * - SVG is sanitized: no scripts, handlers, javascript: links or foreign HTML;
 * - files over the hard limit are refused, and large ones flagged.
 * PNG, WebP, AVIF, SVG and GIF keep their format.
 */

export type PreparedUpload = {
  bytes: Uint8Array;
  name: string;
  type: DetectedType;
  /** What hygiene did, in words, for the editor ("Removed location data"). */
  notes: string[];
  /** Larger than the warning size: the editor confirms before uploading. */
  large: boolean;
  width?: number;
  height?: number;
};

export type PrepareResult = { ok: true; upload: PreparedUpload } | { ok: false; message: string };

export type HygieneOptions = {
  maxEdge?: number;
  /** Only images are accepted (an image field), or anything (a file field). */
  accept?: 'image' | 'any';
};

const IMAGE_TYPES = new Set<DetectedType>(['jpeg', 'png', 'gif', 'webp', 'avif', 'heic', 'svg']);

export async function prepareUpload(
  file: File,
  options: HygieneOptions = {},
): Promise<PrepareResult> {
  const maxEdge = options.maxEdge ?? 3000;
  const original = new Uint8Array(await file.arrayBuffer());
  const type = detectType(original);
  if (options.accept === 'image' && !IMAGE_TYPES.has(type)) {
    return {
      ok: false,
      message: `${file.name} isn’t an image this site can use (JPEG, PNG, WebP, AVIF, GIF or SVG).`,
    };
  }

  const notes: string[] = [];
  let bytes: Uint8Array = original;
  let name = file.name;
  let width: number | undefined;
  let height: number | undefined;

  if (type === 'svg') {
    const clean = sanitizeSvg(new TextDecoder().decode(original));
    if (clean.removed) notes.push('Removed scripts and unsafe links from the SVG');
    bytes = new TextEncoder().encode(clean.svg);
  } else if (type === 'heic') {
    const converted = await reencode(new Blob([original]), 'image/jpeg', maxEdge);
    if (!converted) {
      return {
        ok: false,
        message:
          'This browser can’t convert iPhone (HEIC) photos. Export the photo as JPEG first, or upload it from Safari.',
      };
    }
    bytes = converted.bytes;
    ({ width, height } = converted);
    name = name.replace(/\.(heic|heif)$/i, '') + '.jpg';
    notes.push('Converted from HEIC to JPEG', 'Removed location and camera data');
  } else if (type === 'jpeg' || type === 'png' || type === 'webp') {
    const facts = imageFacts(type, original);
    ({ width, height } = facts);
    const sideways = (facts.orientation ?? 1) !== 1;
    const tooBig = Math.max(facts.width ?? 0, facts.height ?? 0) > maxEdge;
    if (sideways || tooBig) {
      // The pixels change, so re-encode (which also drops all metadata).
      const mime = type === 'jpeg' ? 'image/jpeg' : type === 'png' ? 'image/png' : 'image/webp';
      const converted = await reencode(new Blob([original], { type: mime }), mime, maxEdge);
      if (converted) {
        bytes = converted.bytes;
        if (tooBig)
          notes.push(
            `Resized from ${String(facts.width)}×${String(facts.height)} to ${String(converted.width)}×${String(converted.height)}`,
          );
        if (sideways) notes.push('Turned the photo upright');
        ({ width, height } = converted);
      } else {
        bytes = strip(type, original);
        notes.push('Couldn’t resize this image in this browser, so it was kept at full size');
      }
    } else {
      bytes = strip(type, original);
    }
    if (facts.hasLocation) notes.push('Removed location data');
    else if (facts.hasMetadata) notes.push('Removed camera and editing metadata');
  }

  if (bytes.length > UPLOAD_MAX_BYTES) {
    return {
      ok: false,
      message: `${name} is ${megabytes(bytes.length)} even after processing. The limit is ${megabytes(UPLOAD_MAX_BYTES)}.`,
    };
  }
  return {
    ok: true,
    upload: {
      bytes,
      name,
      type: type === 'heic' ? 'jpeg' : type,
      notes,
      large: bytes.length > UPLOAD_WARN_BYTES,
      ...(width !== undefined ? { width } : {}),
      ...(height !== undefined ? { height } : {}),
    },
  };
}

function strip(type: 'jpeg' | 'png' | 'webp', bytes: Uint8Array): Uint8Array {
  if (type === 'jpeg') return stripJpeg(bytes);
  if (type === 'png') return stripPng(bytes);
  return stripWebp(bytes);
}

export function megabytes(n: number): string {
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** "812 bytes", "48 KB", "3.2 MB". */
export function fileSize(n: number): string {
  if (n < 1024) return `${String(n)} bytes`;
  if (n < 1024 * 1024) return `${String(Math.round(n / 1024))} KB`;
  return megabytes(n);
}

/**
 * Decodes, applies EXIF orientation, scales to fit `maxEdge` and encodes.
 * Returns null where the browser can't decode the file (HEIC outside
 * Safari) or has no canvas.
 */
async function reencode(
  blob: Blob,
  mime: string,
  maxEdge: number,
): Promise<{ bytes: Uint8Array; width: number; height: number } | null> {
  if (typeof createImageBitmap !== 'function') return null;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
  } catch {
    return null;
  }
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) return null;
  context.imageSmoothingQuality = 'high';
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const out = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, mime, mime === 'image/png' ? undefined : 0.9);
  });
  // A browser that can't write this format hands back PNG; keep the original then.
  if (!out || out.type !== mime) return null;
  return { bytes: new Uint8Array(await out.arrayBuffer()), width, height };
}

/**
 * Removes anything that can run or navigate: scripts, event handlers,
 * javascript: and data: links, embedded HTML, and animations that rewrite
 * links or handlers. Drawing content is kept as it was.
 */
export function sanitizeSvg(svg: string): { svg: string; removed: boolean } {
  const purify = DOMPurify(window);
  let removed = false;
  purify.addHook('uponSanitizeElement', (node, data) => {
    if (data.tagName === 'set' || /^animate/i.test(data.tagName)) {
      const target = (node as Element).getAttribute('attributeName') ?? '';
      if (/^(on|href$|xlink:href$)/i.test(target)) {
        node.parentNode?.removeChild(node);
        removed = true;
      }
    }
  });
  purify.addHook('uponSanitizeAttribute', (_node, data) => {
    if (
      /^(href|xlink:href)$/i.test(data.attrName) &&
      /^\s*(javascript|data|vbscript):/i.test(data.attrValue)
    ) {
      data.keepAttr = false;
      removed = true;
    }
  });
  const clean = purify.sanitize(svg, {
    USE_PROFILES: { svg: true, svgFilters: true },
    FORBID_TAGS: ['foreignObject', 'script', 'iframe', 'embed', 'object'],
  });
  // DOMPurify always reports the <body> it parsed into; anything else was really removed.
  if (purify.removed.some((r) => !('element' in r) || r.element.nodeName !== 'BODY'))
    removed = true;
  return {
    svg: clean.startsWith('<svg') ? clean : `<svg xmlns="http://www.w3.org/2000/svg"></svg>`,
    removed,
  };
}
