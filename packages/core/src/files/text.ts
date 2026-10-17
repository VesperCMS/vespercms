/**
 * Byte ↔ text handling that never changes a file by accident.
 *
 * - The BOM is kept as part of the text (`ignoreBOM: true`). The default
 *   TextDecoder silently strips it, so a save would drop it.
 * - Invalid UTF-8 is refused (`fatal: true`) rather than replaced with U+FFFD,
 *   which would corrupt the file on save. Such files are read-only.
 */
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
const encoder = new TextEncoder();

export const BOM = '\uFEFF';

/** Decodes UTF-8 bytes, keeping any BOM. Returns `null` for bytes that aren't valid UTF-8. */
export function decodeUtf8(bytes: Uint8Array): string | null {
  try {
    return decoder.decode(bytes);
  } catch {
    return null;
  }
}

export function encodeUtf8(text: string): Uint8Array {
  return encoder.encode(text);
}

export type LineEnding = '\n' | '\r\n';

export type LineEndingInfo = {
  /** The more common ending; LF when there are no line breaks at all. */
  dominant: LineEnding;
  crlf: number;
  lf: number;
  mixed: boolean;
};

export function lineEndings(text: string): LineEndingInfo {
  let crlf = 0;
  let lf = 0;
  for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) {
    if (i > 0 && text.charCodeAt(i - 1) === 13) crlf++;
    else lf++;
  }
  return { dominant: crlf > lf ? '\r\n' : '\n', crlf, lf, mixed: crlf > 0 && lf > 0 };
}

/** Offsets at which each line starts. `lineStarts(text)[n]` is where line n (0-based) begins. */
export function lineStarts(text: string): number[] {
  const starts = [0];
  for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) starts.push(i + 1);
  return starts;
}

/** 0-based line number of `offset`. */
export function lineOf(starts: readonly number[], offset: number): number {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if ((starts[mid] ?? 0) <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/**
 * The line ending used by the line containing `offset`, or `fallback` when
 * that line has none (the last line of a file without a final newline).
 */
export function lineEndingAt(text: string, offset: number, fallback: LineEnding): LineEnding {
  const nl = text.indexOf('\n', offset);
  if (nl === -1) return fallback;
  return nl > 0 && text.charCodeAt(nl - 1) === 13 ? '\r\n' : '\n';
}

/** Rewrites every line break in `fragment` (written with `\n`) to `eol`. */
export function withLineEnding(fragment: string, eol: LineEnding): string {
  const normalized = fragment.replace(/\r\n/g, '\n');
  return eol === '\n' ? normalized : normalized.replace(/\n/g, '\r\n');
}
