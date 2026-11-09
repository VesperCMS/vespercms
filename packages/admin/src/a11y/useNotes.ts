import type {
  A11yNote,
  BodyFormat,
  CollectionManifest,
  DataObject,
  Manifest,
} from '@vespercms/core';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { a11yChecker } from './run.ts';

type Checker = ReturnType<typeof a11yChecker>;

export type EntryNotes = {
  /** Field notes in form order, then the body's. */
  notes: A11yNote[];
};

const NONE: EntryNotes = { notes: [] };

export type EntryNotesResult = EntryNotes & {
  /** Checks the current values now, without the pause (for a save). */
  recheck: () => Promise<A11yNote[]>;
};

/**
 * The entry's accessibility notes (spec §6.18, layer 1), checked a moment
 * after typing stops, the same pause as the body's validation. Files the
 * entry points at, PDFs among them, aren't opened (DECISIONS.md, "Vesper
 * doesn't check PDFs").
 */
export function useEntryNotes(options: {
  manifest: Manifest;
  collection: CollectionManifest;
  values: DataObject;
  /** The body without its leading line breaks, as the body editor has it. */
  body: string | undefined;
  format: BodyFormat;
}): EntryNotesResult {
  const { manifest, collection, values, body, format } = options;
  const load = useMemo(() => {
    let loaded: Promise<Checker> | null = null;
    return () => (loaded ??= import('./run.ts').then((checks) => checks.a11yChecker(manifest)));
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

  const latest = useRef({ collection, values, body, format });
  useEffect(() => {
    latest.current = { collection, values, body, format };
  });
  const recheck = useCallback(async () => {
    const check = await load();
    const now = latest.current;
    return check(now.collection, {
      values: now.values,
      ...(now.body !== undefined ? { body: now.body } : {}),
      format: now.format,
    }).notes;
  }, [load]);

  return useMemo(() => ({ notes: found.notes, recheck }), [found, recheck]);
}
