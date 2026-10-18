/*
 * The studio's accessibility rules (spec §6.18, layer 1). One catalog, so
 * every note is written the same way: a plain message about this case, one
 * sentence on why it matters, and a docs page for the longer explanation.
 * Vesper reports problems; it never claims a page is compliant (D19).
 */

export const A11Y_RULE_IDS = [
  'missing-alt',
  'alt-file-name',
  'alt-redundant',
  'alt-too-long',
  'heading-skip',
  'heading-extra-top',
  'heading-empty',
  'link-vague',
  'link-new-window',
  'table-header',
  'color-contrast',
  'tag-name-empty',
  'fake-list',
  'pdf-untagged',
  'pdf-no-title',
  'pdf-no-language',
  'video-captions',
] as const;

export type A11yRuleId = (typeof A11Y_RULE_IDS)[number];

export type A11yRule = {
  id: A11yRuleId;
  /** What the rule looks for, for the docs and the config check. */
  title: string;
  /** One sentence on why it matters, shown with every note. */
  why: string;
  /** The page in the docs that explains it (a path; the docs site arrives in Phase 9). */
  docs: string;
};

const rule = (id: A11yRuleId, title: string, why: string): A11yRule => ({
  id,
  title,
  why,
  docs: `accessibility/${id}`,
});

export const A11Y_RULES: Readonly<Record<A11yRuleId, A11yRule>> = {
  'missing-alt': rule(
    'missing-alt',
    'Images with no alt text that aren’t marked decorative',
    'Screen readers announce an image with no description by its file name, or not at all.',
  ),
  'alt-file-name': rule(
    'alt-file-name',
    'Alt text that is a file name',
    'Screen reader users hear the file name instead of what the image shows.',
  ),
  'alt-redundant': rule(
    'alt-redundant',
    'Alt text that starts with “Image of”',
    'Screen readers already say it’s an image, so listeners hear it twice.',
  ),
  'alt-too-long': rule(
    'alt-too-long',
    'Very long alt text',
    'Alt text is read in one go and can’t be skimmed or paused, so long descriptions belong in the page text.',
  ),
  'heading-skip': rule(
    'heading-skip',
    'Headings that skip a level',
    'Screen reader users move through a page by its headings, and a skipped level looks like a missing section.',
  ),
  'heading-extra-top': rule(
    'heading-extra-top',
    'An extra top-level heading in the body',
    'The page’s title is its main heading, and a second one makes the outline harder to follow.',
  ),
  'heading-empty': rule(
    'heading-empty',
    'Empty headings',
    'Screen readers announce an empty heading as a heading with no name, which is confusing.',
  ),
  'link-vague': rule(
    'link-vague',
    'Link text that doesn’t say where it goes',
    'Screen reader users often list a page’s links on their own, where “click here” means nothing.',
  ),
  'link-new-window': rule(
    'link-new-window',
    'Links that open a new tab without saying so',
    'A new tab breaks the Back button, and people who can’t see the screen don’t know it happened.',
  ),
  'table-header': rule(
    'table-header',
    'Tables without a header row',
    'Screen readers use the header row to say which column each cell is in.',
  ),
  'color-contrast': rule(
    'color-contrast',
    'Text colours with too little contrast against the site’s backgrounds',
    'Low-contrast text is hard to read for people with low vision, and for everyone on a phone in sunlight.',
  ),
  'tag-name-empty': rule(
    'tag-name-empty',
    'Embeds and components whose accessible name is empty',
    'Screen readers announce the frame or player by this name, and without it people can’t tell what it is.',
  ),
  'fake-list': rule(
    'fake-list',
    'Lines typed to look like a list',
    'Screen readers announce a real list and how many items it has; typed dashes are read as one paragraph.',
  ),
  'pdf-untagged': rule(
    'pdf-untagged',
    'PDFs without tags',
    'Without tags, screen readers can’t tell headings, lists and tables apart, and may read the text out of order.',
  ),
  'pdf-no-title': rule(
    'pdf-no-title',
    'PDFs without a document title',
    'Screen readers and browser tabs show the title, and without one people hear a file name.',
  ),
  'pdf-no-language': rule(
    'pdf-no-language',
    'PDFs without a language',
    'Screen readers choose their voice and pronunciation from the document’s language.',
  ),
  'video-captions': rule(
    'video-captions',
    'Videos that may not have captions',
    'Deaf and hard-of-hearing visitors need captions, and so does anyone watching with the sound off.',
  ),
};

export function isA11yRuleId(value: unknown): value is A11yRuleId {
  return typeof value === 'string' && (A11Y_RULE_IDS as readonly string[]).includes(value);
}
