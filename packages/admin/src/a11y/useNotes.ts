import {
  resolveMediaPath,
  type A11yNote,
  type BodyFormat,
  type CollectionManifest,
  type DataObject,
  type Manifest,
  type PdfFacts,
  type PdfTarget,
} from '@vesper/core';
import { useEffect, useMemo, useState } from 'react';
import type { a11yChecker } from './run.ts';

type Checks = typeof import('./run.ts');
type Checker = ReturnType<typeof a11yChecker>;

export type EntryNotes = {
  /** Field notes in form order, then the body's, then the PDFs'. */
  notes: A11yNote[];
  /** PDFs the entry points at. */
  pdfs: PdfTarget[];
};

const NONE: EntryNotes = { notes: [], pdfs: [] };

/**
 * What each PDF says about itself, by the URL the studio reads it from, for
 * as long as the studio is open: a PDF is read once, however often its entry
 * is checked. A file that can't be read gets no notes rather than wrong ones.
 */
const pdfFacts = new Map<string, Promise<PdfFacts | null>>();

function factsFor(url: string): Promise<PdfFacts | null> {
  let facts = pdfFacts.get(url);
  if (!facts) {
    facts = (async () => {
      try {
        const response = await fetch(url);
        if (!response.ok) return null;
        const bytes = await response.arrayBuffer();
        const { readPdfFacts } = await import('./pdf.ts');
        return await readPdfFacts(bytes);
      } catch {
        return null;
      }
    })();
    pdfFacts.set(url, facts);
  }
  return facts;
}

/**
 * The entry's accessibility notes (spec §6.18, layer 1), checked a moment
 * after typing stops, the same pause as the body's validation. PDFs are read
 * with PDF.js, and their notes join when they have been.
 */
export function useEntryNotes(options: {
  manifest: Manifest;
  collection: CollectionManifest;
  values: DataObject;
  /** The body without its leading line breaks, as the body editor has it. */
  body: string | undefined;
  format: BodyFormat;
  /** The entry's file, which relative PDF paths are resolved against. */
  entryPath: string;
  /** Where the studio reads a site file from. */
  fileUrl: (path: string) => string;
}): EntryNotes {
  const { manifest, collection, values, body, format, entryPath, fileUrl } = options;
  const load = useMemo(() => {
    let loaded: Promise<{ checks: Checks; check: Checker }> | null = null;
    return () =>
      (loaded ??= import('./run.ts').then((checks) => ({
        checks,
        check: checks.a11yChecker(manifest),
      })));
  }, [manifest]);

  const [found, setFound] = useState<EntryNotes>(NONE);
  useEffect(() => {
    let live = true;
    const timer = setTimeout(() => {
      void load().then(({ check }) => {
        if (live)
          setFound(check(collection, { values, ...(body !== undefined ? { body } : {}), format }));
      });
    }, 300);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [load, collection, values, body, format]);

  const [pdfNotes, setPdfNotes] = useState<A11yNote[]>([]);
  useEffect(() => {
    let live = true;
    void load()
      .then(({ checks }) =>
        Promise.all(
          found.pdfs.map(async (pdf) => {
            const path = resolveMediaPath(pdf.href, entryPath);
            const facts = path === null ? null : await factsFor(fileUrl(path));
            return facts ? checks.pdfNotes(pdf, facts) : [];
          }),
        ),
      )
      .then((notes) => {
        if (live) setPdfNotes(notes.flat());
      });
    return () => {
      live = false;
    };
  }, [load, found.pdfs, entryPath, fileUrl]);

  return useMemo(
    () => ({ notes: [...found.notes, ...pdfNotes], pdfs: found.pdfs }),
    [found, pdfNotes],
  );
}
