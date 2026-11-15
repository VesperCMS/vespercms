import type { FormManifest } from '../manifest/types.ts';
import type { ContractHarness } from '../storage/contract.ts';
import type {
  FormAnswer,
  FormConfigResponse,
  FormSettings,
  FormSubmission,
} from '../forms/types.ts';
import type { CloudStudioSettings } from './protocol.ts';

/*
 * The forms half of `runCloudContract` (spec §6.13, §7.6, D20 as amended
 * 2026-11-15): what `<Form>` relies on from the cloud's endpoint, and what
 * the cloud must never do with a form. The fake cloud and the real one both
 * run it.
 *
 * The fixture's site has `CONTACT_FORM` in its deployed manifest. Its posts
 * come from the fixture's registered origin, each from the IP the test puts
 * in `cf-connecting-ip`, which the fixture's fetch passes through as the
 * client's address. The site starts with no keys, no settings and no kill
 * switch.
 */

/** The fixture site's contact form, as its deployed manifest has it. */
export const CONTACT_FORM: FormManifest = {
  name: 'contact',
  options: { title: 'Contact us', confirmation: { emailField: 'email' } },
  fields: [
    {
      path: ['name'],
      kind: 'string',
      required: true,
      label: 'Your name',
      widget: 'text',
      autocomplete: 'name',
      constraints: { min: 1 },
    },
    {
      path: ['email'],
      kind: 'string',
      required: true,
      label: 'Email',
      widget: 'email',
      format: 'email',
      autocomplete: 'email',
    },
    {
      path: ['department'],
      kind: 'enum',
      required: true,
      label: 'Department',
      widget: 'radio',
      constraints: {
        options: [
          { value: 'admissions', label: 'Admissions' },
          { value: 'other', label: 'Something else' },
        ],
      },
    },
    {
      path: ['message'],
      kind: 'string',
      required: true,
      label: 'Message',
      widget: 'textarea',
      constraints: { min: 10 },
    },
  ],
};

/** An email sent with the site's own Resend key. */
export type SentFormEmail = {
  kind: 'notification' | 'confirmation';
  to: string;
  replyTo?: string;
  subject: string;
  text: string;
};

export type FormsFixture = {
  /** Saves a form's settings, as a site admin does in the dashboard (without its checks). */
  configure: (form: string, settings: FormSettings) => Promise<void>;
  /** The site's own keys, as a site admin sets them. Mail sent with the Resend key is kept by the fixture. */
  keys: (keys: { resend: boolean; akismet: boolean }) => Promise<void>;
  /** The operator's kill switch, for this site. */
  kill: (on: boolean) => Promise<void>;
  /** What the site keeps for a form, newest first, once deliveries in flight are done. */
  submissions: (form: string) => Promise<FormSubmission[]>;
  /** Emails sent with the site's key, oldest first, once deliveries in flight are done. */
  sent: () => Promise<SentFormEmail[]>;
};

type Fixture = {
  settings: CloudStudioSettings;
  origin: string;
  fetch: typeof fetch;
  forms: FormsFixture;
};

const good = {
  name: ' Ada Lovelace ',
  email: 'ada@example.edu',
  department: 'other',
  message: 'Is the library open on Sunday?',
};

export function formsContract(create: () => Promise<Fixture>, t: ContractHarness): void {
  const { describe, it, equal } = t;
  const ok = (value: unknown, message: string) => {
    equal(Boolean(value), true, message);
  };
  let ips = 0;
  /** A fresh client address for each post that shouldn't count toward another's limit. */
  const ip = () => `198.51.100.${String((ips++ % 250) + 1)}`;

  const endpoint = (fixture: Fixture, form = 'contact') =>
    `${fixture.settings.api}/forms/${encodeURIComponent(fixture.settings.project)}/${form}`;

  async function post(
    fixture: Fixture,
    fields: Record<string, string>,
    options: {
      json?: boolean;
      origin?: string | null;
      from?: string;
      form?: string;
      body?: string;
    } = {},
  ): Promise<Response> {
    const headers: Record<string, string> = {
      'content-type': 'application/x-www-form-urlencoded',
      'cf-connecting-ip': options.from ?? ip(),
    };
    if (options.json !== false) headers.accept = 'application/json';
    const origin = options.origin === undefined ? fixture.origin : options.origin;
    if (origin !== null) headers.origin = origin;
    return fixture.fetch(endpoint(fixture, options.form), {
      method: 'POST',
      headers,
      body: options.body ?? new URLSearchParams(fields).toString(),
      redirect: 'manual',
    });
  }

  async function answerOf(response: Response): Promise<FormAnswer> {
    return (await response.json()) as FormAnswer;
  }

  async function ready(fixture: Fixture, settings: Partial<FormSettings> = {}) {
    await fixture.forms.keys({ resend: true, akismet: true });
    await fixture.forms.configure('contact', {
      notify: ['desk@example.edu'],
      match: 'first',
      rules: [],
      ...settings,
    });
  }

  describe('forms', () => {
    it('takes a submission with JavaScript and without, keeps it, and notifies', async () => {
      const fixture = await create();
      await ready(fixture);
      const json = await post(fixture, good);
      equal(json.status, 200, 'a post from the script is taken');
      equal(await answerOf(json), { ok: true }, 'and answered in JSON');
      equal(
        json.headers.get('access-control-allow-origin'),
        fixture.origin,
        'the site’s own page may read the answer',
      );
      const plain = await post(
        fixture,
        { ...good, _vesper_page: '/contact/?x=1' },
        { json: false },
      );
      equal(plain.status, 303, 'a post without JavaScript is sent back');
      equal(
        plain.headers.get('location'),
        `${fixture.origin}/contact/#vesper-form-contact-sent`,
        'to its page’s sent message',
      );
      const kept = await fixture.forms.submissions('contact');
      equal(kept.length, 2, 'both are kept');
      equal(kept[0]?.status, 'new', 'as new');
      equal(kept[0]?.spam, 'ham', 'checked by Akismet');
      equal(kept[0]?.values.name, 'Ada Lovelace', 'with their answers read');
      const sent = await fixture.forms.sent();
      equal(
        sent.map((one) => [one.kind, one.to, one.replyTo]),
        [
          ['notification', 'desk@example.edu', 'ada@example.edu'],
          ['notification', 'desk@example.edu', 'ada@example.edu'],
        ],
        'the desk is notified each time, with replies going to the submitter',
      );
      ok(sent[0]?.text.includes('Is the library open on Sunday?'), 'with the answers');
    });

    it('answers a problem the person can fix, and keeps nothing', async () => {
      const fixture = await create();
      await ready(fixture);
      const json = await post(fixture, { ...good, email: 'nope', message: '' });
      equal(json.status, 400, 'refused');
      equal(
        await answerOf(json),
        {
          ok: false,
          error: 'invalid',
          message: 'Some answers need another look.',
          issues: [
            { field: 'email', message: 'Enter an email address, such as name@example.com.' },
            { field: 'message', message: 'This is required.' },
          ],
        },
        'naming each field, in the form’s order',
      );
      const page = await post(fixture, { ...good, email: 'nope' }, { json: false });
      equal(page.status, 400, 'without JavaScript too');
      ok(
        (page.headers.get('content-type') ?? '').startsWith('text/html'),
        'with a page of its own',
      );
      const html = await page.text();
      ok(html.includes('There is a problem'), 'that summarizes what’s wrong');
      ok(html.includes('value="nope"'), 'and draws the form again with the answers kept');
      equal((await fixture.forms.submissions('contact')).length, 0, 'nothing is kept');
      equal((await fixture.forms.sent()).length, 0, 'or sent');
    });

    it('refuses posts from anywhere but the site, too big, to no form, and floods', async () => {
      const fixture = await create();
      await ready(fixture);
      equal((await post(fixture, good, { origin: null })).status, 403, 'a post with no origin');
      equal(
        (await post(fixture, good, { origin: 'https://elsewhere.example' })).status,
        403,
        'a post from another site',
      );
      equal((await post(fixture, good, { form: 'nope' })).status, 404, 'a form the site lacks');
      equal(
        (await post(fixture, good, { body: `message=${'x'.repeat(70_000)}` })).status,
        413,
        'a body past 64 KB',
      );
      const from = '203.0.113.9';
      let limited: Response | null = null;
      for (let i = 0; i < 60 && !limited; i++) {
        const answer = await post(fixture, good, { from });
        if (answer.status === 429) limited = answer;
      }
      ok(limited, 'a flood from one address is stopped');
      equal(limited ? (await answerOf(limited)).ok : true, false, 'in words');
      equal((await post(fixture, good)).status, 200, 'and someone else still gets through');
    });

    it('answers a filled honeypot as sent, and keeps and sends nothing', async () => {
      const fixture = await create();
      await ready(fixture);
      const answer = await post(fixture, { ...good, _vesper_hp: 'cheap pills' });
      equal(await answerOf(answer), { ok: true }, 'a bot learns nothing');
      equal((await fixture.forms.submissions('contact')).length, 0, 'nothing is kept');
      equal((await fixture.forms.sent()).length, 0, 'or sent');
    });

    it('keeps what Akismet calls spam as spam, and sends nothing for it', async () => {
      const fixture = await create();
      await ready(fixture, {
        confirmation: { subject: 'Thanks, {name}', body: 'We have your message.' },
      });
      const answer = await post(fixture, { ...good, name: 'akismet-guaranteed-spam' });
      equal(await answerOf(answer), { ok: true }, 'answered as sent');
      const kept = await fixture.forms.submissions('contact');
      equal([kept[0]?.status, kept[0]?.spam], ['spam', 'spam'], 'kept as spam');
      equal((await fixture.forms.sent()).length, 0, 'with no notification or confirmation');
    });

    it('stops a paused form and a killed site, and says which forms are paused', async () => {
      const fixture = await create();
      await ready(fixture, { paused: true });
      const paused = await post(fixture, good);
      equal(paused.status, 503, 'a paused form refuses');
      const said = await answerOf(paused);
      equal(said.ok ? null : said.error, 'paused', 'saying it’s paused');
      const config = await fixture.fetch(
        `${fixture.settings.api}/forms/${encodeURIComponent(fixture.settings.project)}/config`,
        { headers: { origin: fixture.origin } },
      );
      equal(
        ((await config.json()) as FormConfigResponse).paused,
        ['contact'],
        'the script can ask',
      );
      await ready(fixture, { paused: false });
      equal((await post(fixture, good)).status, 200, 'unpaused, it takes posts again');
      await fixture.forms.kill(true);
      equal((await post(fixture, good)).status, 503, 'the kill switch stops every form');
      await fixture.forms.kill(false);
      equal((await post(fixture, good)).status, 200, 'until it’s off');
      equal((await fixture.forms.submissions('contact')).length, 2, 'refused posts are never kept');
    });

    it('sends Admissions to one address and everything else to another', async () => {
      const fixture = await create();
      await ready(fixture, {
        notify: ['desk@example.edu'],
        rules: [
          {
            id: 'admissions',
            when: { field: 'department', op: 'is', value: 'admissions' },
            notify: ['admissions@example.edu'],
          },
        ],
      });
      await post(fixture, { ...good, department: 'admissions' });
      await post(fixture, { ...good, department: 'other' });
      equal(
        (await fixture.forms.sent()).map((one) => one.to),
        ['admissions@example.edu', 'desk@example.edu'],
        'each to its own address',
      );
      equal(
        (await fixture.forms.submissions('contact')).map((one) => one.fired),
        [[], ['admissions']],
        'and each says which rule fired',
      );
    });

    it('confirms through the site’s own key only, echoing only safe fields, at most 3 a day to one address', async () => {
      const fixture = await create();
      await ready(fixture, {
        replyTo: 'desk@example.edu',
        // As if saved past the dashboard's checks: {message} isn't safe to echo.
        confirmation: { subject: 'Thanks, {name}', body: 'Dear {name}, you wrote: {message}' },
      });
      for (let i = 0; i < 4; i++)
        await post(fixture, { ...good, message: 'Visit https://spam.example now' });
      const confirmations = (await fixture.forms.sent()).filter(
        (one) => one.kind === 'confirmation',
      );
      equal(confirmations.length, 3, 'one address gets 3 in a day at most');
      equal(confirmations[0]?.to, 'ada@example.edu', 'sent to the email field');
      equal(confirmations[0]?.replyTo, 'desk@example.edu', 'replies go to the site');
      equal(confirmations[0]?.subject, 'Thanks, Ada Lovelace', 'with the name filled in');
      ok(!confirmations.some((one) => one.text.includes('spam.example')), 'and never the message');

      await fixture.forms.keys({ resend: false, akismet: true });
      await post(fixture, { ...good, email: 'grace@example.edu' });
      equal(
        (await fixture.forms.sent()).filter((one) => one.to === 'grace@example.edu').length,
        0,
        'a site without its own key sends nothing',
      );
      equal((await fixture.forms.submissions('contact')).length, 5, 'but keeps the submission');
    });
  });
}
