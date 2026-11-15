import { formId } from './html.ts';
import type { FormRefusal } from './types.ts';

/*
 * How a post is answered, the same from the dev API, the fake cloud and the
 * real one: JSON when the script asked for it, otherwise a redirect back to
 * the page (success) or the cloud's own page (a fixable problem).
 */

/** A form's post is at most this many bytes: no form without uploads needs more. */
export const MAX_FORM_BODY = 64 * 1024;

export const FORM_STATUS: Record<FormRefusal, number> = {
  invalid: 400,
  paused: 503,
  limited: 429,
  refused: 403,
  unavailable: 503,
  'not-found': 404,
  'too-large': 413,
};

/** Whether the request came from `<Form>`'s script, which asks for JSON. */
export function wantsJson(accept: string | null): boolean {
  return accept?.split(',').some((type) => type.trim().startsWith('application/json')) ?? false;
}

/**
 * Where a sent form goes back to: the page it was on, at the sent message.
 * `_vesper_page` is resolved against the post's own origin, which the
 * caller has already checked is the site's, and anything on another origin
 * is ignored, so the endpoint can't send a browser elsewhere.
 */
export function sentAddress(page: string | null, origin: string, name: string): string {
  const fallback = new URL('/', origin);
  let target = fallback;
  try {
    const resolved = new URL(page ?? '/', origin);
    if (resolved.origin === fallback.origin) target = resolved;
  } catch {
    // An address that doesn't parse goes to the site's home page.
  }
  target.hash = `${formId(name)}-sent`;
  target.search = '';
  return target.href;
}

/** The page a form was on, for the cloud's page's link back. */
export function backAddress(page: string | null, origin: string): string {
  const address = new URL(sentAddress(page, origin, 'x'));
  address.hash = '';
  return address.href;
}
