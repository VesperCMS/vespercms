/*
 * `@vespercms/core/forms`: what `<Form>`, its script, the dev API and the
 * cloud share (spec §6.13, §7.6). It runs in the browser too, so it stays
 * small: the build's diagnostics live in the main entry, beside the manifest.
 */
export * from './types.ts';
export {
  TEXTAREA_CAP,
  TEXT_CAP,
  answerRequired,
  choicesOf,
  confirmationField,
  fieldName,
  formControl,
  formField,
  formLeaves,
  formTitle,
  optionLabel,
  type FormControl,
} from './fields.ts';
export { readSubmission, type ReadSubmission, type SubmissionInput } from './read.ts';
export { conditionHolds, routeSubmission, valueAt } from './route.ts';
export {
  answerText,
  echoableFields,
  mergeConfirmation,
  safeToEcho,
  templateIssues,
} from './confirm.ts';
export {
  FORM_STRINGS,
  escapeHtml,
  fieldId,
  formHtml,
  formPage,
  formId,
  targetId,
  type FormHtmlOptions,
  type FormStrings,
} from './html.ts';
export { FORM_STATUS, MAX_FORM_BODY, backAddress, sentAddress, wantsJson } from './answer.ts';
