import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { buildManifest } from '../manifest/build.ts';
import type { FormManifest } from '../manifest/types.ts';
import { mergeConfirmation, safeToEcho, templateIssues } from './confirm.ts';
import { formLeaves } from './fields.ts';
import { readSubmission } from './read.ts';
import { routeSubmission } from './route.ts';
import type { FormSettings } from './types.ts';

const contactSchema = z.object({
  name: z.string().min(1).meta({ label: 'Your name', autocomplete: 'name' }),
  email: z.email().meta({ label: 'Email', autocomplete: 'email' }),
  phone: z.string().optional().meta({ label: 'Phone', widget: 'tel', autocomplete: 'tel' }),
  department: z.enum(['admissions', 'financial-aid', 'other']).meta({
    label: 'Department',
    widgetOptions: {
      labels: {
        admissions: 'Admissions',
        'financial-aid': 'Financial aid',
        other: 'Something else',
      },
    },
  }),
  topics: z
    .array(z.enum(['events', 'news']))
    .min(1)
    .meta({ label: 'Topics' }),
  age: z.number().int().min(0).optional().meta({ label: 'Age' }),
  subscribe: z.boolean().optional().meta({ label: 'Send me the newsletter' }),
  visit: z.string().optional().meta({ label: 'Visit date', widget: 'date' }),
  message: z.string().min(10).meta({ label: 'Message', widget: 'textarea' }),
  address: z
    .object({
      city: z.string().meta({ label: 'City' }),
      zip: z
        .string()
        .regex(/^\d{5}$/)
        .optional()
        .meta({ label: 'ZIP' }),
    })
    .optional()
    .meta({ label: 'Address' }),
});

async function contact(): Promise<FormManifest> {
  const manifest = await buildManifest({
    site: { srcDir: 'src' },
    collections: [],
    forms: [
      {
        name: 'contact',
        schema: contactSchema,
        options: { confirmation: { emailField: 'email' } },
      },
    ],
  });
  const form = manifest.forms[0];
  if (!form) throw new Error('no form');
  return form;
}

const good = {
  name: '  Ada  Lovelace ',
  email: 'ada@example.edu',
  department: 'admissions',
  topics: ['events', 'news', 'events'],
  message: 'Line one\r\nLine two, long enough.',
};

describe('readSubmission', () => {
  it('turns posted strings into values and drops what the form doesn’t have', async () => {
    const form = await contact();
    const read = readSubmission(form, {
      ...good,
      age: '42',
      subscribe: 'yes',
      visit: '2026-11-15',
      'address.city': 'Abingdon',
      sneaky: 'dropped',
      _vesper_page: 'https://site.example/contact/',
      _vesper_manifest: 'abc',
    });
    expect(read.issues).toEqual([]);
    expect(read.values).toEqual({
      name: 'Ada Lovelace',
      email: 'ada@example.edu',
      department: 'admissions',
      topics: ['events', 'news'],
      age: 42,
      subscribe: true,
      visit: '2026-11-15',
      message: 'Line one\nLine two, long enough.',
      address: { city: 'Abingdon' },
    });
    expect(read.page).toBe('https://site.example/contact/');
    expect(read.manifest).toBe('abc');
    expect(read.honeypot).toBe(false);
  });

  it('reads URLSearchParams, as the browser posts them', async () => {
    const form = await contact();
    const body = new URLSearchParams();
    for (const [key, value] of Object.entries(good)) {
      for (const one of Array.isArray(value) ? value : [value]) body.append(key, one);
    }
    body.append('_vesper_hp', 'buy now');
    const read = readSubmission(form, body);
    expect(read.issues).toEqual([]);
    expect(read.values.topics).toEqual(['events', 'news']);
    expect(read.honeypot).toBe(true);
  });

  it('says what’s wrong, once per field, in the form’s order', async () => {
    const form = await contact();
    const read = readSubmission(form, {
      email: 'not-an-address',
      department: 'nope',
      age: 'many',
      visit: '2026-02-30',
      message: 'short',
      'address.zip': '123',
    });
    expect(read.issues).toEqual([
      { field: 'name', message: 'This is required.' },
      { field: 'email', message: 'Enter an email address, such as name@example.com.' },
      { field: 'department', message: 'Choose one of Admissions, Financial aid, Something else.' },
      { field: 'topics', message: 'Choose at least 1.' },
      { field: 'age', message: 'Enter a number.' },
      { field: 'visit', message: 'Enter a date, such as 2026-11-15.' },
      { field: 'message', message: 'Use at least 10 characters.' },
      { field: 'address.city', message: 'This is required.' },
      { field: 'address.zip', message: 'This isn’t in the form the site expects.' },
    ]);
  });

  it('asks for a choice in words, and leaves an optional group out when it’s empty', async () => {
    const form = await contact();
    const read = readSubmission(form, { ...good, department: '' });
    expect(read.issues).toEqual([{ field: 'department', message: 'Choose one.' }]);
    expect('address' in read.values).toBe(false);
  });

  it('caps text the schema leaves open', async () => {
    const form = await contact();
    const read = readSubmission(form, { ...good, phone: '5'.repeat(501) });
    expect(read.issues).toEqual([{ field: 'phone', message: 'Use at most 500 characters.' }]);
  });
});

describe('routeSubmission', () => {
  const settings: FormSettings = {
    notify: ['desk@example.edu'],
    match: 'first',
    rules: [
      {
        id: 'a',
        when: { field: 'department', op: 'is', value: 'Admissions' },
        notify: ['admissions@example.edu'],
      },
      {
        id: 'b',
        when: { field: 'topics', op: 'is', value: 'news' },
        notify: ['news@example.edu', 'ADMISSIONS@example.edu'],
      },
      { id: 'spam', when: { field: 'message', op: 'contains', value: 'casino' }, spam: true },
    ],
  };

  it('fires the first rule that holds, or the otherwise route', () => {
    expect(routeSubmission(settings, { department: 'admissions', topics: ['news'] })).toEqual({
      fired: ['a'],
      notify: ['admissions@example.edu'],
      confirmation: null,
      spam: false,
    });
    expect(routeSubmission(settings, { department: 'other', topics: [] }).notify).toEqual([
      'desk@example.edu',
    ]);
  });

  it('fires every rule that holds, each address once', () => {
    const every = routeSubmission(
      { ...settings, match: 'every' },
      {
        department: 'admissions',
        topics: ['news'],
      },
    );
    expect(every.fired).toEqual(['a', 'b']);
    expect(every.notify).toEqual(['admissions@example.edu', 'news@example.edu']);
  });

  it('keeps spam from notifying anyone', () => {
    const route = routeSubmission(
      { ...settings, match: 'every' },
      {
        department: 'admissions',
        message: 'Visit our CASINO',
      },
    );
    expect(route).toMatchObject({ spam: true, notify: [], confirmation: null });
  });

  it('compares each kind of answer', () => {
    const holds = (op: FormSettings['rules'][number]['when'], values: Record<string, unknown>) =>
      routeSubmission(
        { notify: [], match: 'first', rules: [{ id: 'x', when: op }] },
        values as never,
      ).fired.length === 1;
    expect(holds({ field: 'a', op: 'is-empty' }, { a: '' })).toBe(true);
    expect(holds({ field: 'a', op: 'is-not-empty' }, { a: [] })).toBe(false);
    expect(holds({ field: 'a', op: 'is-one-of', value: ['x', 'Y'] }, { a: 'y' })).toBe(true);
    expect(holds({ field: 'a', op: 'is-not', value: 'x' }, { a: 'z' })).toBe(true);
    expect(holds({ field: 'a', op: 'is', value: 'yes' }, { a: true })).toBe(true);
    expect(holds({ field: 'a', op: 'is', value: 'true' }, { a: true })).toBe(true);
    expect(holds({ field: 'a', op: 'is', value: '3' }, { a: 3 })).toBe(true);
    expect(holds({ field: 'g.c', op: 'is', value: 'Abingdon' }, { g: { c: 'abingdon' } })).toBe(
      true,
    );
    expect(holds({ field: 'a', op: 'contains', value: '' }, { a: 'anything' })).toBe(false);
  });

  it('uses a rule’s own confirmation, or none', () => {
    const template = { subject: 'Thanks', body: 'Hi' };
    const own = { subject: 'Admissions', body: 'Hello' };
    const base: FormSettings = { notify: [], match: 'first', rules: [], confirmation: template };
    expect(routeSubmission(base, {}).confirmation).toEqual(template);
    expect(
      routeSubmission(
        { ...base, rules: [{ id: 'a', when: { field: 'x', op: 'is-empty' }, confirmation: own }] },
        {},
      ).confirmation,
    ).toEqual(own);
    expect(
      routeSubmission(
        { ...base, rules: [{ id: 'a', when: { field: 'x', op: 'is-empty' }, confirmation: null }] },
        {},
      ).confirmation,
    ).toBeNull();
  });
});

describe('confirmations (D20)', () => {
  it('treats name fields as safe to echo, and nothing else unless marked', async () => {
    const form = await contact();
    const safe = formLeaves(form.fields)
      .filter(safeToEcho)
      .map((f) => f.path.join('.'));
    expect(safe).toEqual(['name']);
    expect(
      safeToEcho({
        path: ['x'],
        kind: 'string',
        required: true,
        label: 'X',
        autocomplete: 'section-a shipping given-name',
      }),
    ).toBe(true);
    expect(
      safeToEcho({
        path: ['x'],
        kind: 'string',
        required: true,
        label: 'X',
        autocomplete: 'name',
        safeToEcho: false,
      }),
    ).toBe(false);
    expect(
      safeToEcho({ path: ['x'], kind: 'string', required: true, label: 'X', safeToEcho: true }),
    ).toBe(true);
  });

  it('never fills a field that isn’t safe to echo', async () => {
    const form = await contact();
    const merged = mergeConfirmation(
      {
        subject: 'Thanks, {name}\n{message}',
        body: 'Hi {name}. You wrote: {message}. {email} {nope}',
      },
      form,
      { name: 'Ada\nLovelace', message: 'Click https://bad.example', email: 'victim@example.com' },
    );
    expect(merged.subject).toBe('Thanks, Ada Lovelace');
    expect(merged.text).toBe('Hi Ada\nLovelace. You wrote: .  ');
    expect(merged.text).not.toContain('bad.example');
    expect(merged.text).not.toContain('victim');
  });

  it('refuses a template that names a field it can’t use', async () => {
    const form = await contact();
    expect(templateIssues({ subject: 'Hi {name}', body: '{message} {nope}' }, form)).toEqual([
      "{message} can't be used: only fields that are safe to echo can be repeated back.",
      "{nope} isn't a field of this form.",
    ]);
    expect(templateIssues({ subject: 'Hi {name}', body: 'Thanks' }, form)).toEqual([]);
  });
});
