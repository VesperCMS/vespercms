import type { DataObject } from '../files/equal.ts';

/*
 * The forms protocol (spec §6.13, §7.6): what `<Form>` posts, what the cloud
 * answers, and a form's delivery settings as the dashboard keeps them. The
 * fake cloud and the real one both speak it, and `runCloudContract` checks
 * that they agree.
 */

/** The honeypot: a field people never see, so anything in it came from a bot. */
export const HONEYPOT_FIELD = '_vesper_hp';
/** The page the form was on, for coming back to it without JavaScript. */
export const PAGE_FIELD = '_vesper_page';
/** The hash of the manifest the page was built with, so the cloud can tell its copy is older. */
export const MANIFEST_FIELD = '_vesper_manifest';

/**
 * Names `<Form>` and the cloud keep for themselves. `cf-turnstile-response`
 * isn't used today (DECISIONS.md, "Forms send with the site's own Resend key
 * and check spam with its own Akismet key"); it stays reserved so a later
 * Turnstile option can't collide with a site's field.
 */
export const RESERVED_FIELD_NAMES: readonly string[] = [
  PAGE_FIELD,
  HONEYPOT_FIELD,
  MANIFEST_FIELD,
  'cf-turnstile-response',
];

/** One field's problem: its name as `<Form>` posts it (`address.city`), and what to say. */
export type FormIssue = { field: string; message: string };

export type FormRuleOperator =
  'is' | 'is-not' | 'contains' | 'is-one-of' | 'is-empty' | 'is-not-empty';

export type FormCondition = {
  /** The field's name as `<Form>` posts it. */
  field: string;
  op: FormRuleOperator;
  /** A list for `is-one-of`; nothing for `is-empty` and `is-not-empty`. */
  value?: string | string[];
};

/** A confirmation email, with `{field}` tokens for fields that are safe to echo (D20). */
export type FormTemplate = { subject: string; body: string };

/** "When **Department** is **Admissions**, notify **admissions@college.edu**." */
export type FormRule = {
  id: string;
  when: FormCondition;
  notify?: string[];
  /** A confirmation of this route's own; `null` sends none. Absent: the form's. */
  confirmation?: FormTemplate | null;
  /** Keep what this rule catches as spam, and send nothing. */
  spam?: boolean;
};

/** A form's delivery settings, kept by the dashboard (spec §6.13: operational, not content). */
export type FormSettings = {
  /** Who's notified when no rule fires: the otherwise route. */
  notify: string[];
  match: 'first' | 'every';
  rules: FormRule[];
  /** The confirmation email, when the form has `confirmation.emailField`. */
  confirmation?: FormTemplate | null;
  /** Where replies to a confirmation go. */
  replyTo?: string;
  paused?: boolean;
  /** How many days a submission is kept. Spam is kept `SPAM_RETENTION_DAYS`. */
  retentionDays?: number;
  /** Whether Akismet checks this form, where the site has a key. On unless turned off. */
  akismet?: boolean;
};

export const DEFAULT_FORM_SETTINGS: FormSettings = { notify: [], match: 'first', rules: [] };
/** About six months: libraries keep as little about patrons as they can (DECISIONS.md, "Phase 6a's calls"). */
export const DEFAULT_RETENTION_DAYS = 183;
export const SPAM_RETENTION_DAYS = 30;
/** D20, amended: confirmations to one address in a day, per site. */
export const CONFIRMATIONS_PER_ADDRESS = 3;
/** D20, amended: confirmations a site sends in a day. */
export const CONFIRMATIONS_PER_SITE = 50;

/** Which rules fired, and what they ask for. `fired` is empty when the otherwise route caught it. */
export type FormRoute = {
  fired: string[];
  notify: string[];
  confirmation: FormTemplate | null;
  spam: boolean;
};

export type FormRefusal =
  'invalid' | 'paused' | 'limited' | 'refused' | 'unavailable' | 'not-found' | 'too-large';

/** The cloud's answer to a post that asked for JSON (`Accept: application/json`). */
export type FormAnswer =
  | { ok: true }
  | { ok: false; error: 'invalid'; message: string; issues: FormIssue[] }
  | { ok: false; error: Exclude<FormRefusal, 'invalid'>; message: string };

/** `GET /forms/{project}/config`: what the script needs before anyone types. */
export type FormConfigResponse = { paused: string[] };

/** The words of each refusal, the same from the fake cloud, the real one and the dev API. */
export const FORM_REFUSALS: Record<FormRefusal, string> = {
  invalid: 'Some answers need another look.',
  paused: 'This form isn’t taking submissions right now.',
  limited: 'Too many messages were sent from here just now. Try again in a few minutes.',
  refused: 'This form can only be sent from its own site.',
  unavailable: 'Your message couldn’t be sent just now. Try again in a moment.',
  'not-found': 'This form doesn’t exist.',
  'too-large': 'Your message is too long to send.',
};

/** What `defineForm` takes beside the schema, carried in the manifest's `options`. */
export type FormOptions = {
  /** The form's name in the inbox and in emails. Its key in `forms` when absent. */
  title?: string;
  /** Shown once the form is sent. */
  successMessage?: string;
  /** The button's words. "Send" when absent. */
  submitLabel?: string;
  /** Turns on the confirmation email, sent to this field's address (D20). */
  confirmation?: { emailField: string };
};

export type SubmissionStatus = 'new' | 'handled' | 'spam';

/** What Akismet said: `off` when the site has no key or the form turned it off. */
export type SpamVerdict = 'ham' | 'spam' | 'unchecked' | 'off';

/** A stored submission, as the inbox and the contract see it. */
export type FormSubmission = {
  id: string;
  form: string;
  values: DataObject;
  status: SubmissionStatus;
  spam: SpamVerdict;
  /** The rules that fired; empty when the otherwise route caught it. */
  fired: string[];
  createdAt: string;
};
