import type {
  A11yNote,
  BodyFormat,
  CollectionManifest,
  DataObject,
  Manifest,
  PdfTarget,
} from '@vesper/core';
import { useEffect, useMemo, useState } from 'react';
import type { a11yChecker } from './run.ts';

type Checker = ReturnType<typeof a11yChecker>;

export type EntryNotes = {
  notes: A11yNote[];
  /** PDFs the entry points at, still to be read. */
  pdfs: PdfTarget[];
};

const NONE: EntryNotes = { notes: [], pdfs: [] };

/**
 * The entry's accessibility notes (spec §6.18, layer 1), checked a moment
 * after typing stops, the same pause as the body's validation.
 */
export function useEntryNotes(options: {
  manifest: Manifest;
  collection: CollectionManifest;
  values: DataObject;
  /** The body without its leading line breaks, as the body editor has it. */
  body: string | undefined;
  format: BodyFormat;
}): EntryNotes {
  const { manifest, collection, values, body, format } = options;
  const load = useMemo(() => {
    let loaded: Promise<Checker> | null = null;
    return () => (loaded ??= import('./run.ts').then((module) => module.a11yChecker(manifest)));
  }, [manifest]);
  const [found, setFound] = useState<EntryNotes>(NONE);
  useEffect(() => {
    let live = true;
    const timer = setTimeout(() => {
      void load().then((check) => {
        if (live)
          setFound(check(collection, { values, ...(body !== undefined ? { body } : {}), format }));
      });
    }, 300);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [load, collection, values, body, format]);
  return found;
}
