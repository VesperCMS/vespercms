// @vitest-environment jsdom
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { buildManifest, type FormManifest } from '@vespercms/core';
import { formHtml } from '@vespercms/core/forms';
import { build, type Rolldown } from 'vite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'astro/zod';
import { mountForms } from '../../components/form/ui.ts';

/*
 * <Form>'s script (spec §6.13): its size budget, and what it does in a page,
 * in jsdom with the cloud's answers stubbed.
 */

// jsdom's import.meta.url isn't a file URL; the tests run from the repository's root.
const entry = join(process.cwd(), 'packages/astro/components/form/ui.ts');

describe('<Form>’s script', () => {
  it('stays within 8 KB gzipped, with core’s checks bundled in', async () => {
    const result = (await build({
      configFile: false,
      logLevel: 'silent',
      resolve: { conditions: ['@vesper/source'] },
      build: {
        write: false,
        minify: true,
        lib: { entry, formats: ['es'], fileName: 'ui' },
      },
    })) as Rolldown.RolldownOutput[];
    const code = result
      .flatMap((output) => output.output)
      .map((chunk) => (chunk.type === 'chunk' ? chunk.code : ''))
      .join('');
    const gzipped = gzipSync(code).length;
    expect(gzipped, `${String(gzipped)} bytes gzipped`).toBeLessThanOrEqual(8 * 1024);
  }, 60_000);
});

async function contactForm(): Promise<FormManifest> {
  const manifest = await buildManifest({
    site: { srcDir: 'src' },
    collections: [],
    forms: [
      {
        name: 'contact',
        schema: z.object({
          name: z.string().min(1).meta({ label: 'Your name' }),
          email: z.email().meta({ label: 'Email' }),
          department: z.enum(['admissions', 'other']).meta({ label: 'Department' }),
        }),
        options: { successMessage: 'Thanks, Ada.' },
      },
    ],
  });
  return manifest.forms[0] as FormManifest;
}

async function page(endpoint = 'https://api.example/forms/site_1') {
  const form = await contactForm();
  document.body.innerHTML = formHtml(form, {
    action: `${endpoint}/contact`,
    page: '/contact/',
    manifest: 'hash',
    sentMessage: true,
    config: JSON.stringify({ form, endpoint, strings: {} }),
  });
  mountForms();
  const element = document.querySelector('form');
  if (!element) throw new Error('no form');
  return element;
}

const input = (id: string) => document.getElementById(id) as HTMLInputElement;
const submit = (form: HTMLFormElement) => {
  form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('mountForms', () => {
  it('stops a post with problems, links each from the summary and moves focus there', async () => {
    const fetch = vi.fn((_url: string, _init?: RequestInit) =>
      Promise.resolve(new Response(JSON.stringify({ paused: [] }))),
    );
    vi.stubGlobal('fetch', fetch);
    const form = await page('https://api.example/forms/site_0');
    input('vesper-form-contact-email').value = 'nope';
    submit(form);
    await vi.waitFor(() => {
      expect(document.activeElement?.id).toBe('vesper-form-contact-summary');
    });
    const links = [...document.querySelectorAll('[data-vesper-form-summary] a')].map((a) => [
      a.getAttribute('href'),
      a.textContent,
    ]);
    expect(links).toEqual([
      ['#vesper-form-contact-name', 'Your name: This is required.'],
      ['#vesper-form-contact-email', 'Email: Enter an email address, such as name@example.com.'],
      ['#vesper-form-contact-department-0', 'Department: Choose one.'],
    ]);
    expect(input('vesper-form-contact-email').getAttribute('aria-invalid')).toBe('true');
    expect(input('vesper-form-contact-email').getAttribute('aria-describedby')).toBe(
      'vesper-form-contact-email-error',
    );
    expect(form.noValidate).toBe(true);
    // Focus moving into the form asks whether it's paused; nothing is posted.
    expect(fetch.mock.calls.filter(([, init]) => init?.method === 'POST')).toEqual([]);
  });

  it('posts the form encoded, asking for JSON, then shows the sent message and focuses it', async () => {
    const fetch = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ ok: true }))));
    vi.stubGlobal('fetch', fetch);
    const form = await page();
    input('vesper-form-contact-name').value = 'Ada';
    input('vesper-form-contact-email').value = 'ada@example.edu';
    input('vesper-form-contact-department-0').checked = true;
    submit(form);
    await vi.waitFor(() => {
      expect(document.activeElement?.id).toBe('vesper-form-contact-sent');
    });
    expect(document.querySelector('[data-vesper-form]')?.hasAttribute('data-sent')).toBe(true);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.example/forms/site_1/contact');
    expect((init.headers as Record<string, string>).accept).toBe('application/json');
    const body = init.body as URLSearchParams;
    expect(body.get('name')).toBe('Ada');
    expect(body.get('_vesper_page')).toBe('/contact/');
    expect(body.get('_vesper_hp')).toBe('');
  });

  it('shows the cloud’s own problems, and says a paused form is paused', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({ ok: false, error: 'limited', message: 'Too many messages.' }),
          ),
        ),
      ),
    );
    const form = await page();
    input('vesper-form-contact-name').value = 'Ada';
    input('vesper-form-contact-email').value = 'ada@example.edu';
    input('vesper-form-contact-department-1').checked = true;
    submit(form);
    await vi.waitFor(() => {
      expect(document.activeElement?.id).toBe('vesper-form-contact-summary');
    });
    expect(document.querySelector('[data-vesper-form-summary] p')?.textContent).toBe(
      'Too many messages.',
    );

    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response(JSON.stringify({ paused: ['contact'] })))),
    );
    // Another site's endpoint: each endpoint's answer is asked for once.
    const paused = await page('https://api.example/forms/site_2');
    input('vesper-form-contact-name').focus();
    await vi.waitFor(() => {
      expect(document.body.textContent).toContain('This form isn’t taking submissions right now.');
    });
    expect(paused.isConnected).toBe(false);
  });
});
