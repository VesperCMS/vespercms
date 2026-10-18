import { A11Y_RULES } from './rules.ts';

/*
 * The structure rules the build checks with axe-core (spec §6.18, layer 2),
 * each with a message in the studio's style: plain words about what's wrong
 * and one sentence on why it matters. Only rules that need no layout or
 * colour: contrast and other visual rules are for rendered scans (layer 3).
 * The list is pinned by a test, so a new axe rule never joins unreviewed.
 */

export type BuildRule = { message: string; why: string };

const LANG_WHY = 'Screen readers choose their voice and pronunciation from the page’s language.';
const LANDMARK_WHY =
  'Screen reader users move around a page by its landmarks, and content outside them is easy to miss.';
const NAME_WHY =
  'Screen readers announce controls by their names, and without one people can’t tell what it does.';
const ARIA_WHY =
  'Wrong ARIA tells screen readers something untrue, which is worse than no ARIA at all.';
const LIST_WHY =
  'Screen readers announce a list and how many items it has only when its structure is right.';
const TABLE_WHY = A11Y_RULES['table-header'].why;

const named = (what: string): BuildRule => ({
  message: `${what} has no accessible name.`,
  why: NAME_WHY,
});

export const BUILD_RULES: Readonly<Record<string, BuildRule>> = {
  'html-has-lang': { message: 'The page doesn’t say what language it’s in.', why: LANG_WHY },
  'html-lang-valid': { message: 'The page’s language code isn’t a real one.', why: LANG_WHY },
  'valid-lang': { message: 'A language code on this page isn’t a real one.', why: LANG_WHY },
  'html-xml-lang-mismatch': { message: 'The page’s lang and xml:lang disagree.', why: LANG_WHY },
  'document-title': {
    message: 'The page has no title.',
    why: 'The title is the first thing screen readers say, and what tabs and bookmarks show.',
  },
  'landmark-one-main': { message: 'The page has no main landmark.', why: LANDMARK_WHY },
  'landmark-no-duplicate-main': {
    message: 'The page has more than one main landmark.',
    why: LANDMARK_WHY,
  },
  'landmark-no-duplicate-banner': {
    message: 'The page has more than one header landmark.',
    why: LANDMARK_WHY,
  },
  'landmark-no-duplicate-contentinfo': {
    message: 'The page has more than one footer landmark.',
    why: LANDMARK_WHY,
  },
  'landmark-main-is-top-level': {
    message: 'The main landmark is inside another landmark.',
    why: LANDMARK_WHY,
  },
  'landmark-banner-is-top-level': {
    message: 'The header landmark is inside another landmark.',
    why: LANDMARK_WHY,
  },
  'landmark-contentinfo-is-top-level': {
    message: 'The footer landmark is inside another landmark.',
    why: LANDMARK_WHY,
  },
  'landmark-unique': {
    message: 'Two landmarks of the same kind have the same name.',
    why: LANDMARK_WHY,
  },
  region: { message: 'Some content is outside every landmark.', why: LANDMARK_WHY },
  bypass: {
    message: 'There’s no way to skip to the main content.',
    why: 'Keyboard users otherwise have to tab through the whole header on every page.',
  },
  'heading-order': { message: 'A heading skips a level.', why: A11Y_RULES['heading-skip'].why },
  'page-has-heading-one': {
    message: 'The page has no main heading (h1).',
    why: 'Screen reader users often jump to the main heading first to find where the content starts.',
  },
  'empty-heading': { message: 'A heading is empty.', why: A11Y_RULES['heading-empty'].why },
  'image-alt': {
    message: 'Describe this image, or mark it decorative.',
    why: A11Y_RULES['missing-alt'].why,
  },
  'input-image-alt': { message: 'An image button has no alt text.', why: NAME_WHY },
  'role-img-alt': named('An image (role="img")'),
  'svg-img-alt': named('An SVG image'),
  'area-alt': { message: 'An image map area has no alt text.', why: NAME_WHY },
  'object-alt': { message: 'An embedded object has no text alternative.', why: NAME_WHY },
  label: {
    message: 'A form field has no label.',
    why: 'Screen readers announce a field by its label, and without one people can’t tell what to enter.',
  },
  'select-name': { message: 'A select menu has no label.', why: NAME_WHY },
  'form-field-multiple-labels': { message: 'A form field has more than one label.', why: NAME_WHY },
  'input-button-name': { message: 'A button has no text.', why: NAME_WHY },
  'link-name': {
    message: 'A link has no text, so it can’t say where it goes.',
    why: A11Y_RULES['link-vague'].why,
  },
  'button-name': {
    message: 'A button has no text, so screen readers can’t say what it does.',
    why: NAME_WHY,
  },
  'frame-title': {
    message: 'An embedded frame has no title.',
    why: A11Y_RULES['tag-name-empty'].why,
  },
  'summary-name': { message: 'A “details” summary has no text.', why: NAME_WHY },
  'duplicate-id': {
    message: 'Two elements share an id.',
    why: 'Labels, links and ARIA find elements by id, and a repeated id can point at the wrong one.',
  },
  'duplicate-id-aria': {
    message: 'An id that a label or ARIA attribute points at appears more than once.',
    why: 'Labels, links and ARIA find elements by id, and a repeated id can point at the wrong one.',
  },
  'aria-allowed-attr': {
    message: 'An ARIA attribute isn’t allowed on this element.',
    why: ARIA_WHY,
  },
  'aria-hidden-body': { message: 'The whole page is hidden from screen readers.', why: ARIA_WHY },
  'aria-hidden-focus': {
    message: 'Something hidden from screen readers can still take keyboard focus.',
    why: ARIA_WHY,
  },
  'aria-required-attr': {
    message: 'An ARIA role is missing an attribute it needs.',
    why: ARIA_WHY,
  },
  'aria-required-children': {
    message: 'An ARIA role is missing the children it needs.',
    why: ARIA_WHY,
  },
  'aria-required-parent': {
    message: 'An ARIA role is outside the parent it needs.',
    why: ARIA_WHY,
  },
  'aria-roles': { message: 'An ARIA role isn’t a real role.', why: ARIA_WHY },
  'aria-valid-attr': {
    message: 'An ARIA attribute is misspelled or doesn’t exist.',
    why: ARIA_WHY,
  },
  'aria-valid-attr-value': {
    message: 'An ARIA attribute has a value it can’t take.',
    why: ARIA_WHY,
  },
  'aria-prohibited-attr': {
    message: 'An ARIA attribute isn’t allowed with this role.',
    why: ARIA_WHY,
  },
  'aria-deprecated-role': { message: 'An ARIA role is deprecated.', why: ARIA_WHY },
  'aria-conditional-attr': {
    message: 'An ARIA attribute is used where it doesn’t apply.',
    why: ARIA_WHY,
  },
  'aria-command-name': named('A button, link or menu item'),
  'aria-input-field-name': named('An input field'),
  'aria-toggle-field-name': named('A toggle'),
  'aria-meter-name': named('A meter'),
  'aria-progressbar-name': named('A progress bar'),
  'aria-tooltip-name': named('A tooltip'),
  'aria-dialog-name': named('A dialog'),
  'nested-interactive': {
    message: 'A control is inside another control.',
    why: 'Screen readers can’t reach or announce controls that are nested in each other.',
  },
  list: { message: 'A list holds something that isn’t a list item.', why: LIST_WHY },
  listitem: { message: 'A list item isn’t inside a list.', why: LIST_WHY },
  dlitem: {
    message: 'A definition term or description isn’t inside a definition list.',
    why: LIST_WHY,
  },
  'definition-list': {
    message: 'A definition list holds something other than terms and descriptions.',
    why: LIST_WHY,
  },
  'th-has-data-cells': { message: 'A table header has no cells under it.', why: TABLE_WHY },
  'td-headers-attr': {
    message: 'A table cell points at headers outside its table.',
    why: TABLE_WHY,
  },
};

/** The axe rule IDs the build runs, in the order above. */
export const BUILD_RULE_IDS: readonly string[] = Object.keys(BUILD_RULES);
