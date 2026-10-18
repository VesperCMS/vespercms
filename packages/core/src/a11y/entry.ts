import type { BodyFormat } from '../body/types.ts';
import type { CollectionManifest, Manifest } from '../manifest/types.ts';
import { checkBody, tagDefinitions, type TagDefinitions } from './body.ts';
import { checkFields } from './fields.ts';
import type { A11yNote, PdfTarget } from './types.ts';

/*
 * Every layer-1 check for one entry (spec §6.18), with the site's settings
 * from the manifest: field notes in form order, then the body's in document
 * order, and the PDFs the studio still has to read.
 */

export type EntryCheckInput = {
  /** The entry's raw frontmatter or data values. */
  values: unknown;
  body?: string;
  format?: BodyFormat;
};

export type EntryCheck = { notes: A11yNote[]; pdfs: PdfTarget[] };

/** Accessibility checks bound to a site, so the tag definitions are worked out once. */
export function entryChecker(
  manifest: Manifest,
): (collection: CollectionManifest, input: EntryCheckInput) => EntryCheck {
  const tags: TagDefinitions = tagDefinitions(manifest.markdoc, manifest.mdx);
  const backgrounds = manifest.site.a11y?.backgrounds ?? [];
  return (collection, input) => {
    const fields = checkFields(collection.fields, input.values, { backgrounds });
    if (input.body === undefined || collection.entryKind !== 'content') return fields;
    const body = checkBody(input.body, input.format ?? 'md', {
      headingStart: collection.presentation.headingStart ?? 2,
      tags,
      ...(manifest.markdoc ? { markdoc: manifest.markdoc.options } : {}),
    });
    return { notes: [...fields.notes, ...body.notes], pdfs: [...fields.pdfs, ...body.pdfs] };
  };
}

/** The notes that refuse a save under the site's `a11y.blockPublishOn` (the publish gate). */
export function blockingNotes(manifest: Manifest, notes: readonly A11yNote[]): A11yNote[] {
  const blocking = new Set(manifest.site.a11y?.blockPublishOn ?? []);
  return notes.filter((note) => blocking.has(note.rule));
}
