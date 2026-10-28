import { entryChecker, type Manifest } from '@vespercms/core';

/*
 * The accessibility checks themselves (spec §6.18). They read bodies with
 * micromark and Markdoc, which are large, so this module loads on first use,
 * like the body checks (DECISIONS.md, "The body editor loads on first use").
 */
export function a11yChecker(manifest: Manifest): ReturnType<typeof entryChecker> {
  return entryChecker(manifest);
}

export { pdfNotes } from '@vespercms/core';
