// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { formDiagnostics } from './diagnostics.ts';
import { buildManifest } from '../manifest/build.ts';
import type { FormManifest } from '../manifest/types.ts';
import { formHtml } from './html.ts';

async function formOf(schema: unknown, options: Record<string, unknown> = {}) {
  const manifest = await buildManifest({
    site: { srcDir: 'src' },
    collections: [],
    forms: [{ name: 'contact', schema, options }],
  });
  const form = manifest.forms[0] as FormManifest;
  return { form, diagnostics: manifest.diagnostics };
}

const schema = z.object({
  name: z
    .string()
    .min(1)
    .meta({ label: 'Your name', autocomplete: 'name', description: 'As you’d like us to say it.' }),
  email: z.email().meta({ label: 'Email', autocomplete: 'email' }),
  department: z.enum(['admissions', 'other']).meta({
    label: 'Department',
    widgetOptions: { labels: { admissions: 'Admissions', other: 'Something else' } },
  }),
  topics: z
    .array(z.enum(['events', 'news']))
    .optional()
    .meta({ label: 'Topics' }),
  subscribe: z.boolean().optional().meta({ label: 'Send me the newsletter' }),
  message: z.string().optional().meta({ label: 'Message', widget: 'textarea' }),
});

function render(form: FormManifest, extra: Partial<Parameters<typeof formHtml>[1]> = {}) {
  document.body.innerHTML = formHtml(form, {
    action: 'https://api.example/forms/site_1/contact',
    page: 'https://site.example/contact/',
    manifest: 'hash',
    sentMessage: true,
    ...extra,
  });
  return document.body;
}

describe('formHtml (spec §6.13)', () => {
  it('labels every field, says what’s required in words, and joins help to its field', async () => {
    const { form } = await formOf(schema);
    const body = render(form);
    const name = body.querySelector<HTMLInputElement>('#vesper-form-contact-name');
    expect(name?.labels?.[0]?.textContent).toBe('Your name (required)');
    expect(name?.required).toBe(true);
    expect(name?.getAttribute('autocomplete')).toBe('name');
    expect(name?.getAttribute('aria-describedby')).toBe('vesper-form-contact-name-help');
    expect(body.querySelector('#vesper-form-contact-name-help')?.textContent).toBe(
      'As you’d like us to say it.',
    );
    expect(body.querySelector<HTMLInputElement>('#vesper-form-contact-email')?.type).toBe('email');
    // Choices are a fieldset whose legend names them.
    const department = body.querySelector('fieldset[data-vesper-field="department"]');
    expect(department?.querySelector('legend')?.textContent).toBe('Department (required)');
    expect([...(department?.querySelectorAll('label') ?? [])].map((l) => l.textContent)).toEqual([
      'Admissions',
      'Something else',
    ]);
    expect(body.querySelector<HTMLInputElement>('#vesper-form-contact-topics-0')?.type).toBe(
      'checkbox',
    );
    // Optional fields say nothing, and a yes-or-no is never required.
    expect(body.querySelector('label[for="vesper-form-contact-message"]')?.textContent).toBe(
      'Message',
    );
    expect(body.querySelector<HTMLInputElement>('#vesper-form-contact-subscribe')?.required).toBe(
      false,
    );
  });

  it('hides the honeypot from eyes and assistive technology, and carries the page and manifest', async () => {
    const { form } = await formOf(schema);
    const body = render(form);
    const trap = body.querySelector('.vesper-form-hp');
    expect(trap?.getAttribute('aria-hidden')).toBe('true');
    expect(trap?.querySelector('input')?.getAttribute('tabindex')).toBe('-1');
    expect(body.querySelector<HTMLInputElement>('input[name="_vesper_page"]')?.value).toBe(
      'https://site.example/contact/',
    );
    expect(body.querySelector<HTMLInputElement>('input[name="_vesper_manifest"]')?.value).toBe(
      'hash',
    );
    expect(body.querySelector('form')?.getAttribute('method')).toBe('post');
    expect(body.querySelector('#vesper-form-contact-sent')?.getAttribute('tabindex')).toBe('-1');
  });

  it('draws a failed post back filled in, each error linked from the summary', async () => {
    const { form } = await formOf(schema);
    const body = render(form, {
      sentMessage: false,
      values: { name: '<Ada>', department: 'other', topics: ['news'], message: 'Hello & bye' },
      issues: [
        { field: 'email', message: 'This is required.' },
        { field: 'department', message: 'Choose one.' },
      ],
    });
    const summary = body.querySelector<HTMLElement>('[data-vesper-form-summary]');
    expect(summary?.hidden).toBe(false);
    expect(
      [...(summary?.querySelectorAll('a') ?? [])].map((a) => [
        a.getAttribute('href'),
        a.textContent,
      ]),
    ).toEqual([
      ['#vesper-form-contact-email', 'Email: This is required.'],
      ['#vesper-form-contact-department-0', 'Department: Choose one.'],
    ]);
    const email = body.querySelector('#vesper-form-contact-email');
    expect(email?.getAttribute('aria-invalid')).toBe('true');
    expect(email?.getAttribute('aria-describedby')).toBe('vesper-form-contact-email-error');
    expect(body.querySelector<HTMLInputElement>('#vesper-form-contact-name')?.value).toBe('<Ada>');
    expect(body.querySelector<HTMLInputElement>('#vesper-form-contact-department-1')?.checked).toBe(
      true,
    );
    expect(body.querySelector<HTMLInputElement>('#vesper-form-contact-topics-1')?.checked).toBe(
      true,
    );
    expect(body.querySelector('textarea')?.value).toBe('Hello & bye');
    expect(body.querySelector('#vesper-form-contact-sent')).toBeNull();
  });

  it('says it isn’t connected, or is paused, in place of its fields', async () => {
    const { form } = await formOf(schema);
    expect(render(form, { action: null }).textContent).toBe('This form isn’t connected yet.');
    expect(render(form, { paused: true }).textContent).toBe(
      'This form isn’t taking submissions right now.',
    );
  });
});

describe('formDiagnostics', () => {
  it('refuses reserved names, uploads, kinds <Form> can’t draw, and a confirmation without an email field', async () => {
    const { diagnostics } = await formOf(
      z.object({
        _vesper_hp: z.string(),
        resume: z.string().meta({ widget: 'upload' }),
        tags: z.array(z.string()),
        name: z.string(),
      }),
      { confirmation: { emailField: 'name' } },
    );
    const codes = diagnostics
      .filter((d) => d.collection === 'form:contact')
      .map((d) => [d.level, d.code]);
    expect(codes).toEqual([
      ['error', 'form-reserved-name'],
      ['error', 'form-upload'],
      ['error', 'form-field-kind'],
      ['error', 'form-confirmation'],
    ]);
  });

  it('warns that a refinement never reaches the cloud', async () => {
    const { form } = await formOf(schema);
    const refined = z.object({
      name: z.string().refine((value) => value !== 'x'),
      group: z.object({ a: z.string().optional() }).superRefine(() => undefined),
    });
    expect(formDiagnostics(form, refined).map((d) => [d.code, d.path])).toEqual([
      ['form-refinement', ['name']],
      ['form-refinement', ['group']],
    ]);
  });
});
