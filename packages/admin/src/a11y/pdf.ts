import type { PdfFacts } from '@vesper/core';
import { GlobalWorkerOptions, getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';

/*
 * What a PDF says about its own accessibility (spec §6.18): whether it's
 * tagged, its title and its language, read with PDF.js in the browser, so it
 * works in every storage mode. This module and PDF.js load only when an entry
 * has a PDF to check. The legacy build runs in browsers older than the
 * modern build's floor (Chrome 140, Firefox 133, Safari 18.2).
 */

GlobalWorkerOptions.workerSrc = workerUrl;

/** Reads the facts the PDF rules need. Nothing is rendered, and no script in the file runs. */
export async function readPdfFacts(bytes: ArrayBuffer | Uint8Array): Promise<PdfFacts> {
  const task = getDocument({
    data: bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes),
    enableXfa: false,
    disableFontFace: true,
    verbosity: 0,
  });
  try {
    const pdf = await task.promise;
    const [mark, meta] = await Promise.all([pdf.getMarkInfo(), pdf.getMetadata()]);
    // A tagged PDF marks itself as tagged and has a structure tree.
    const tree = pdf.numPages > 0 ? await (await pdf.getPage(1)).getStructTree() : null;
    const info = meta.info as { Title?: unknown; Language?: unknown };
    // Typed as always there, but null for a PDF with no XMP metadata.
    const metadata = meta.metadata as { get: (name: string) => unknown } | null;
    const xmpTitle = metadata?.get('dc:title');
    const text = (value: unknown) =>
      typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
    // PDF.js 6 gives the mark info as a Map; older versions as an object.
    const marked: unknown =
      mark instanceof Map ? (mark as Map<string, unknown>).get('Marked') : mark?.Marked;
    return {
      tagged: marked === true && tree !== null,
      title: text(info.Title) ?? text(xmpTitle),
      language: text(info.Language),
    };
  } finally {
    await task.destroy();
  }
}
