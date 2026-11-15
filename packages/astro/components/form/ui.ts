import type { FormManifest } from '@vespercms/core';
import {
  FORM_STRINGS,
  fieldId,
  formField,
  readSubmission,
  targetId,
  type FormAnswer,
  type FormConfigResponse,
  type FormIssue,
  type FormStrings,
} from '@vespercms/core/forms';

/*
 * <Form>'s script (spec §6.13): it only enhances a form that already works
 * without it. It checks answers with core's `readSubmission`, the same
 * checks the cloud runs; posts the same form-encoded body with `fetch`
 * (a simple request, so there's no preflight); and moves focus to the error
 * summary or the sent message. A paused form says so on first focus, before
 * anyone types. No framework, and at most 8 KB gzipped (form/ui.test.ts).
 */

type Config = { form: FormManifest; endpoint: string | null; strings: Partial<FormStrings> };

const pausedAnswers = new Map<string, Promise<FormConfigResponse | null>>();

export function mountForms(root: ParentNode = document): void {
  for (const wrapper of root.querySelectorAll<HTMLElement>('[data-vesper-form]')) mount(wrapper);
}

function mount(wrapper: HTMLElement): void {
  const found = wrapper.querySelector<HTMLFormElement>('form[data-vesper-form-config]');
  if (!found || found.hasAttribute('data-mounted')) return;
  const form: HTMLFormElement = found;
  form.setAttribute('data-mounted', '');
  const config = JSON.parse(form.getAttribute('data-vesper-form-config') ?? '{}') as Config;
  const strings: FormStrings = { ...FORM_STRINGS, ...config.strings };
  const definition = config.form;
  const prefix = wrapper.id;
  const summary = form.querySelector<HTMLElement>('[data-vesper-form-summary]');
  const status = form.querySelector<HTMLElement>('[data-vesper-form-status]');
  const button = form.querySelector<HTMLButtonElement>('.vesper-form-submit');
  const shown = new Map<string, string>();
  let busy = false;
  form.noValidate = true;

  form.addEventListener(
    'focusin',
    () => {
      void checkPaused();
    },
    { once: true },
  );
  // A field's error goes as soon as its answer is fixed, while it's typed or
  // chosen. Errors are added, and the summary changes, only when the form is
  // sent: anything redrawn as a field is left would move the page under a
  // click on Send, and the click would miss.
  const fixed = (event: Event) => {
    const name = (event.target as HTMLElement | null)
      ?.closest<HTMLElement>('[data-vesper-field]')
      ?.getAttribute('data-vesper-field');
    if (!name || !shown.has(name)) return;
    const issue = readSubmission(definition, bodyOf(form)).issues.find((one) => one.field === name);
    if (issue) return;
    shown.delete(name);
    draw(false, false);
  };
  form.addEventListener('input', fixed);
  form.addEventListener('change', fixed);
  summary?.addEventListener('click', (event) => {
    const link = (event.target as HTMLElement | null)?.closest('a');
    const target = link ? document.getElementById(link.hash.slice(1)) : null;
    if (!target) return;
    event.preventDefault();
    target.focus();
    // The label or legend comes into view with the field it names.
    (target.closest('[data-vesper-field]') ?? target).scrollIntoView({ block: 'start' });
  });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!busy) void send();
  });

  async function checkPaused(): Promise<void> {
    if (!config.endpoint) return;
    let answer = pausedAnswers.get(config.endpoint);
    if (!answer) {
      answer = fetch(`${config.endpoint}/config`, { credentials: 'omit' })
        .then((response) => (response.ok ? (response.json() as Promise<FormConfigResponse>) : null))
        .catch(() => null);
      pausedAnswers.set(config.endpoint, answer);
    }
    const paused = (await answer)?.paused;
    if (Array.isArray(paused) && paused.includes(definition.name)) note(strings.paused);
  }

  async function send(): Promise<void> {
    const body = bodyOf(form);
    const read = readSubmission(definition, body);
    if (read.issues.length > 0) {
      show(read.issues);
      return;
    }
    show([]);
    setBusy(true);
    try {
      // getAttribute: a field named "action" would shadow form.action.
      const response = await fetch(form.getAttribute('action') ?? '', {
        method: 'POST',
        body,
        headers: { accept: 'application/json' },
        credentials: 'omit',
      });
      const answer = (await response.json()) as FormAnswer;
      if (answer.ok) sent();
      else if (answer.error === 'invalid') show(answer.issues);
      else if (answer.error === 'paused') note(answer.message);
      else problem(answer.message);
    } catch {
      problem(strings.failed);
    } finally {
      setBusy(false);
    }
  }

  function setBusy(on: boolean): void {
    busy = on;
    if (status) status.textContent = on ? strings.sending : '';
    if (on) button?.setAttribute('aria-disabled', 'true');
    else button?.removeAttribute('aria-disabled');
  }

  function show(issues: FormIssue[]): void {
    shown.clear();
    for (const issue of issues) shown.set(issue.field, issue.message);
    draw(issues.length > 0);
  }

  /** Each field's error beside it, and the summary of all of them; focus goes to the summary when asked. */
  function draw(focus: boolean, summarize = true): void {
    for (const field of form.querySelectorAll<HTMLElement>('[data-vesper-field]')) {
      const name = field.getAttribute('data-vesper-field') ?? '';
      const id = fieldId(prefix, name);
      const message = shown.get(name);
      const group = field.tagName === 'FIELDSET';
      const described = group ? field : document.getElementById(id);
      document.getElementById(`${id}-error`)?.remove();
      const ids = (described?.getAttribute('aria-describedby') ?? '')
        .split(' ')
        .filter((one) => one && one !== `${id}-error`);
      field.classList.toggle('vesper-form-field-error', message !== undefined);
      if (message !== undefined) {
        const error = document.createElement('p');
        error.className = 'vesper-form-error';
        error.id = `${id}-error`;
        error.textContent = message;
        const after =
          document.getElementById(`${id}-help`) ?? field.querySelector(group ? 'legend' : 'label');
        if (field.classList.contains('vesper-form-check')) field.append(error);
        else after?.after(error);
        ids.push(error.id);
      }
      if (ids.length > 0) described?.setAttribute('aria-describedby', ids.join(' '));
      else described?.removeAttribute('aria-describedby');
      if (!group) {
        if (message !== undefined) described?.setAttribute('aria-invalid', 'true');
        else described?.removeAttribute('aria-invalid');
      }
    }
    if (!summary || !summarize) return;
    const list = document.createElement('ul');
    for (const [name, message] of shown) {
      const field = formField(definition, name);
      const link = document.createElement('a');
      link.href = `#${targetId(field, name, { prefix })}`;
      link.textContent = `${field?.label ?? name}: ${message}`;
      const item = document.createElement('li');
      item.append(link);
      list.append(item);
    }
    summary.querySelector('ul, p')?.replaceWith(list);
    summary.hidden = shown.size === 0;
    if (focus && shown.size > 0) summary.focus();
  }

  /** A problem that isn't any one field's: said in the summary, which takes focus. */
  function problem(message: string): void {
    if (!summary) return;
    const text = document.createElement('p');
    text.textContent = message;
    summary.querySelector('ul, p')?.replaceWith(text);
    summary.hidden = false;
    summary.focus();
  }

  function note(message: string): void {
    const text = document.createElement('p');
    text.className = 'vesper-form-note';
    text.tabIndex = -1;
    text.textContent = message;
    const hadFocus = form.contains(document.activeElement);
    form.replaceWith(text);
    if (hadFocus) text.focus();
  }

  function sent(): void {
    wrapper.setAttribute('data-sent', '');
    const message = wrapper.querySelector<HTMLElement>('.vesper-form-sent');
    message?.focus();
  }
}

function bodyOf(form: HTMLFormElement): URLSearchParams {
  const body = new URLSearchParams();
  for (const [key, value] of new FormData(form)) {
    if (typeof value === 'string') body.append(key, value);
  }
  return body;
}
