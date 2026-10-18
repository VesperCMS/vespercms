/*
 * The wording checks behind the alt text, link and fake-list rules. They are
 * deliberately narrow: a note that fires on good content teaches people to
 * ignore notes, so each pattern only matches what is almost always a mistake.
 */

/** Longest alt text before it's better as page text. */
export const ALT_TEXT_LIMIT = 150;

const IMAGE_EXTENSION = /\.(?:jpe?g|png|gif|webp|avif|svg|heic|heif|tiff?|bmp)$/i;
/** Names cameras, phones and screenshot tools give files: IMG_2041, DSC0042, PXL_2026…, Screenshot 2026-… */
const CAMERA_NAME =
  /^(?:img|dsc|dscn|dscf|dcim|pxl|mvimg|gopr|photo|image|screenshot|screen shot)[\s_-]*\d/i;

/** Alt text that is a file name rather than a description. */
export function looksLikeFileName(alt: string): boolean {
  const text = alt.trim();
  if (text === '') return false;
  if (IMAGE_EXTENSION.test(text) && !/\s{2,}/.test(text) && text.split(/\s+/).length <= 3)
    return true;
  if (CAMERA_NAME.test(text)) return true;
  // hero_banner, header-image-2: one "word" joined by underscores or holding digits.
  return /^[a-z0-9]+(?:[_-][a-z0-9]+)+$/i.test(text) && (text.includes('_') || /\d/.test(text));
}

/** The redundant opening of alt text such as “Image of the library steps”, or null. */
export function redundantAltPrefix(alt: string): string | null {
  const match = /^\s*((?:an?\s+)?(?:image|picture|photo|photograph|graphic|icon)\s+of)\b/i.exec(
    alt,
  );
  return match?.[1] ?? null;
}

const VAGUE_LINK_TEXT = new Set([
  'click',
  'click here',
  'click this link',
  'continue',
  'details',
  'find out more',
  'go',
  'here',
  'info',
  'learn more',
  'link',
  'more',
  'more info',
  'more information',
  'read more',
  'see more',
  'this',
  'this link',
  'this page',
]);

/** Link text as a reader would hear it compared: lower case, single spaces, no trailing punctuation. */
function normalizeLinkText(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/[\s.,:;!?…»›→-]+$/u, '');
}

export type VagueLink = 'empty' | 'vague' | 'address';

/** Why a link's text doesn't say where it goes, or null when it does. */
export function vagueLinkText(text: string, href: string): VagueLink | null {
  const normalized = normalizeLinkText(text);
  if (normalized === '') return 'empty';
  if (VAGUE_LINK_TEXT.has(normalized)) return 'vague';
  const bare = (value: string) =>
    value
      .trim()
      .toLowerCase()
      .replace(/^(?:https?:)?\/\//, '')
      .replace(/^www\./, '')
      .replace(/\/$/, '');
  if (/^(?:https?:\/\/|www\.)\S+$/i.test(text.trim())) return 'address';
  if (href !== '' && bare(text) === bare(href) && /[./]/.test(normalized)) return 'address';
  return null;
}

/** Whether a link's text or label tells readers it opens a new tab or window. */
export function saysNewWindow(...texts: (string | undefined)[]): boolean {
  return texts.some(
    (text) => text !== undefined && /\bnew\s+(?:browser\s+)?(?:tab|window)\b/i.test(text),
  );
}

/**
 * A line that starts like a list item: `- `, `* `, `• `, `1. `, `1) `,
 * with or without a Markdown escape (`\- `, `1\. `).
 */
const LIST_LIKE_LINE = /^\s*(?:\\?[-*+•‣◦▪–]|\d{1,3}\\?[.)])[ \t]+\S/u;

/** How many lines of a paragraph's source start like list items. */
export function listLikeLines(source: string): number {
  return source.split(/\r?\n/).filter((line) => LIST_LIKE_LINE.test(line)).length;
}

/** A paragraph typed to look like a list: two or more of its lines start like list items. */
export function isFakeList(source: string): boolean {
  return listLikeLines(source) >= 2;
}

/** Quotes a piece of content for a note's subject, shortened: `“IMG_2041.jpg”`. */
export function quoted(text: string, max = 40): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return `“${flat.length > max ? `${flat.slice(0, max - 1)}…` : flat}”`;
}

/** The last part of a path or address, without its query: `brochure.pdf`. */
export function fileNameOf(path: string): string {
  const clean = path.split(/[?#]/)[0] ?? path;
  return clean.slice(clean.lastIndexOf('/') + 1) || path;
}
