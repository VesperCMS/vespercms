import { isPlainObject, type DataObject, type DataValue } from '../files/equal.ts';
import type { FormCondition, FormRoute, FormSettings } from './types.ts';

/*
 * `routeSubmission` (spec §7.6, step 5): which of a form's rules fire for a
 * submission, and what they ask for. The cloud, the fake cloud, the dev API
 * and the dashboard's test panel all call it, so a rule fires the same way
 * everywhere.
 *
 * Values are compared as text, ignoring case and the space around them. A
 * list of choices "is" a value when it includes it; a yes-or-no is "yes" or
 * "no".
 */

export function routeSubmission(settings: FormSettings, values: DataObject): FormRoute {
  const fired = [];
  for (const rule of settings.rules) {
    if (!conditionHolds(rule.when, values)) continue;
    fired.push(rule);
    if (settings.match === 'first') break;
  }
  if (fired.length === 0) {
    return {
      fired: [],
      notify: unique(settings.notify),
      confirmation: settings.confirmation ?? null,
      spam: false,
    };
  }
  const spam = fired.some((rule) => rule.spam === true);
  const own = fired.find((rule) => rule.confirmation !== undefined);
  return {
    fired: fired.map((rule) => rule.id),
    notify: spam ? [] : unique(fired.flatMap((rule) => rule.notify ?? [])),
    confirmation: spam ? null : own ? (own.confirmation ?? null) : (settings.confirmation ?? null),
    spam,
  };
}

export function conditionHolds(condition: FormCondition, values: DataObject): boolean {
  const answers = textsOf(valueAt(values, condition.field)).map(normal);
  const wanted = (Array.isArray(condition.value) ? condition.value : [condition.value ?? '']).map(
    target,
  );
  switch (condition.op) {
    case 'is-empty':
      return answers.length === 0;
    case 'is-not-empty':
      return answers.length > 0;
    case 'is':
      return answers.some((answer) => answer === wanted[0]);
    case 'is-not':
      return !answers.some((answer) => answer === wanted[0]);
    case 'is-one-of':
      return answers.some((answer) => wanted.includes(answer));
    case 'contains':
      return wanted[0] !== '' && answers.some((answer) => answer.includes(wanted[0] ?? ''));
  }
}

/** The value at a dotted name, through groups. */
export function valueAt(values: DataObject, name: string): DataValue | undefined {
  let current: DataValue | undefined = values;
  for (const key of name.split('.')) {
    if (!isPlainObject(current)) return undefined;
    current = current[key];
  }
  return current;
}

function textsOf(value: DataValue | undefined): string[] {
  if (value === undefined || value === null) return [];
  if (Array.isArray(value)) return value.flatMap(textsOf);
  if (typeof value === 'boolean') return [value ? 'yes' : 'no'];
  if (typeof value === 'number') return [String(value)];
  if (typeof value === 'string') return value.trim() === '' ? [] : [value];
  return [];
}

const normal = (text: string) => text.trim().toLowerCase();

/** A rule's value, with "true" and "false" read as yes and no. */
function target(text: string): string {
  const value = normal(text);
  return value === 'true' ? 'yes' : value === 'false' ? 'no' : value;
}

/** Each address once, as first written. */
function unique(addresses: readonly string[]): string[] {
  const seen = new Map<string, string>();
  for (const address of addresses.map((one) => one.trim())) {
    if (address !== '' && !seen.has(address.toLowerCase()))
      seen.set(address.toLowerCase(), address);
  }
  return [...seen.values()];
}
