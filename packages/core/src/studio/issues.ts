import type { FieldIssue } from './protocol.ts';

/*
 * Turns Zod issues into messages an editor can act on. Zod's own defaults
 * ("Invalid input: expected string, received undefined") are written for
 * developers. A message the schema's author wrote (`.min(1, 'Add a title')`,
 * `.refine(…, 'Alt text is required')`) is always kept as written.
 *
 * Read structurally, so core never imports Zod (CLAUDE.md).
 */

type ZodIssueLike = {
  code?: string;
  path?: PropertyKey[];
  message?: string;
  expected?: string;
  input?: unknown;
  origin?: string;
  minimum?: number | bigint;
  maximum?: number | bigint;
  inclusive?: boolean;
  format?: string;
  values?: unknown[];
};

/** Zod 4's built-in messages all start like this. Anything else came from the schema's author. */
const DEFAULT_MESSAGE = /^(Invalid|Too (small|big)|Expected|Required$)/;

const ARTICLE: Record<string, string> = {
  string: 'text',
  number: 'a number',
  int: 'a whole number',
  boolean: 'yes or no',
  date: 'a date',
  array: 'a list',
  object: 'a group of fields',
};

export function issuesFromZod(issues: readonly unknown[]): FieldIssue[] {
  return issues.map((raw) => {
    const issue = (raw ?? {}) as ZodIssueLike;
    const path = (issue.path ?? []).map((segment) =>
      typeof segment === 'number' ? segment : String(segment),
    );
    return { path, message: messageFor(issue) };
  });
}

function messageFor(issue: ZodIssueLike): string {
  const message = issue.message ?? '';
  if (message && !DEFAULT_MESSAGE.test(message)) return message;

  const min = issue.minimum === undefined ? undefined : Number(issue.minimum);
  const max = issue.maximum === undefined ? undefined : Number(issue.maximum);
  switch (issue.code) {
    case 'invalid_type': {
      // `input` is there when parsing used `reportInput`; otherwise the default message says.
      const missing =
        'input' in issue ? issue.input === undefined : /received undefined/.test(message);
      return missing
        ? 'This is required.'
        : `Enter ${ARTICLE[issue.expected ?? ''] ?? 'a valid value'}.`;
    }
    case 'too_small':
      if (issue.origin === 'string') {
        return min === 1 ? 'This can’t be empty.' : `Use at least ${String(min)} characters.`;
      }
      if (issue.origin === 'array' || issue.origin === 'set') {
        return min === 1 ? 'Add at least one.' : `Add at least ${String(min)}.`;
      }
      if (issue.origin === 'date') return 'Pick a later date.';
      return issue.inclusive === false
        ? `Enter a number above ${String(min)}.`
        : `Enter ${String(min)} or more.`;
    case 'too_big':
      if (issue.origin === 'string') return `Use ${String(max)} characters or fewer.`;
      if (issue.origin === 'array' || issue.origin === 'set') return `Use ${String(max)} at most.`;
      if (issue.origin === 'date') return 'Pick an earlier date.';
      return issue.inclusive === false
        ? `Enter a number below ${String(max)}.`
        : `Enter ${String(max)} or less.`;
    case 'invalid_format':
      if (issue.format === 'email') return 'Enter an email address, like name@example.com.';
      if (issue.format === 'url') return 'Enter a full web address, starting with https://.';
      if (issue.format === 'datetime' || issue.format === 'date') return 'Enter a valid date.';
      return 'This isn’t in the expected format.';
    case 'invalid_value':
      if (issue.values && issue.values.length > 0 && issue.values.length <= 8) {
        return `Choose one of: ${issue.values.map(String).join(', ')}.`;
      }
      return 'Choose one of the listed options.';
    case 'not_multiple_of':
      return 'Enter a number in the allowed steps.';
    case 'unrecognized_keys':
      return 'This has settings the site doesn’t expect.';
    case 'invalid_union':
      return 'This value doesn’t match any of the allowed shapes.';
    default:
      return message || 'This value isn’t valid.';
  }
}
