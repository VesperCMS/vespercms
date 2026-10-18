/*
 * Accessibility checks (spec §6.18). Layer 1: content rules the studio runs
 * as people edit, over an entry's fields and body. Layer 2's plain messages
 * for the build's axe rules live here too, so both layers speak alike.
 * Vesper reports problems; it never claims compliance (D19).
 */
export {
  A11Y_RULES,
  A11Y_RULE_IDS,
  isA11yRuleId,
  type A11yRule,
  type A11yRuleId,
} from './rules.ts';
export type {
  A11yBackground,
  A11yNote,
  A11ySettings,
  A11yTarget,
  PdfFacts,
  PdfTarget,
} from './types.ts';
export {
  altProblems,
  bodyFacts,
  checkBody,
  isSitePdf,
  tagDefinitions,
  type BodyCheck,
  type BodyCheckOptions,
  type BodyFact,
  type TagDefinition,
  type TagDefinitions,
} from './body.ts';
export { checkFields, pdfNotes, type FieldCheck, type FieldCheckOptions } from './fields.ts';
export {
  CONTRAST_MINIMUM,
  contrastRatio,
  formatRatio,
  isContrastUse,
  parseHexColor,
  relativeLuminance,
  type ContrastUse,
  type Rgb,
} from './contrast.ts';
export {
  ALT_TEXT_LIMIT,
  isFakeList,
  looksLikeFileName,
  redundantAltPrefix,
  saysNewWindow,
  vagueLinkText,
} from './text.ts';
export { decodeEntities, htmlElements, htmlTags, plainText } from './html.ts';
