import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/*
 * <Form> against the fake cloud (spec §6.13, Phase 6a): the playground's
 * contact form, built with `vesper({ cloud })` and served by the plain static
 * server (scripts/cloud-site.mjs). The criteria: it works with JavaScript
 * off; it passes §6.13's list (axe in every state, 320 pixels wide and 200%
 * zoom, the error summary's focus); spam is blocked; a routing rule sends
 * Admissions to one address and everything else to another; and a
 * confirmation echoes only what's safe to.
 *
 * The fake cloud is shared, so the tests run one at a time, in order.
 */

test.describe.configure({ mode: 'serial' });

const CLOUD = 'http://127.0.0.1:4406';
const WCAG21_AA = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

type Sent = { kind: string; to: string; replyTo?: string; subject: string; text: string };
type Submission = {
  status: string;
  spam: string;
  values: Record<string, unknown>;
  fired: string[];
};

async function control(path: string, body?: unknown): Promise<unknown> {
  const response = await fetch(`${CLOUD}/__test/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return response.json();
}

const state = async () =>
  ((await control('state')) as { forms: { submissions: Submission[]; sent: Sent[] } }).forms;

async function setUp(
  settings: Record<string, unknown> = {},
  keys = { resend: true, akismet: true },
) {
  await control('forms', {
    reset: true,
    kill: false,
    keys,
    form: 'contact',
    settings: { notify: ['desk@example.edu'], match: 'first', rules: [], ...settings },
  });
}

async function axe(page: Page): Promise<void> {
  const { violations } = await new AxeBuilder({ page }).withTags(WCAG21_AA).analyze();
  expect(
    violations.map(({ id, help, nodes }) => ({ id, help, targets: nodes.map((n) => n.target) })),
  ).toEqual([]);
}

async function fill(
  page: Page,
  answers: { name?: string; email?: string; department?: string } = {},
) {
  await page.getByLabel('Your name').fill(answers.name ?? 'Ada Lovelace');
  await page.getByLabel('Email').fill(answers.email ?? 'ada@example.edu');
  await page.getByRole('radio', { name: answers.department ?? 'Something else' }).check();
  await page.getByLabel('Message').fill('Is the library open on Sunday?');
}

test.beforeEach(async () => {
  await setUp();
});

test('without JavaScript, a post comes back to the sent message, and a problem to a page of the cloud’s', async ({
  browser,
  page: checker,
}) => {
  const context = await browser.newContext({
    javaScriptEnabled: false,
    baseURL: 'http://127.0.0.1:4407',
  });
  const page = await context.newPage();
  const before = (await state()).submissions.length;
  await page.goto('/contact/');
  await fill(page);
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page).toHaveURL(/\/contact\/#vesper-form-contact-sent$/);
  const sent = page.locator('#vesper-form-contact-sent');
  await expect(sent).toBeVisible();
  await expect(sent).toHaveText('Thanks, we will be in touch.');
  await expect(page.locator('form.vesper-form-form')).toBeHidden();
  expect((await state()).submissions.length).toBe(before + 1);

  // A fixable problem: the browser's own checks pass it, the cloud's don't.
  await page.goto('/contact/');
  await fill(page, { email: 'ada@example' });
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page).toHaveURL(`${CLOUD}/api/forms/site_playground/contact`);
  await expect(page.getByRole('heading', { level: 2, name: 'There is a problem' })).toBeVisible();
  await expect(page.getByLabel('Your name')).toHaveValue('Ada Lovelace');
  await expect(page.getByLabel('Email')).toHaveAttribute('aria-invalid', 'true');
  const problem = await page.content();
  // Fixed there, it goes back to the site's page.
  await page.getByLabel('Email').fill('ada@example.edu');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page).toHaveURL('http://127.0.0.1:4407/contact/#vesper-form-contact-sent');
  await context.close();

  // axe needs a script of its own, so each state is checked again where scripts run.
  await checker.goto('/contact/#vesper-form-contact-sent');
  await expect(checker.locator('#vesper-form-contact-sent')).toBeVisible();
  await axe(checker);
  await checker.setContent(problem);
  await axe(checker);
});

test('with JavaScript, problems are linked from a summary that takes focus, and a post stays on the page', async ({
  page,
}) => {
  await page.goto('/contact/');
  await axe(page);
  await page.getByRole('button', { name: 'Send' }).click();
  const summary = page.locator('[data-vesper-form-summary]');
  await expect(summary).toBeFocused();
  await expect(summary.getByRole('link')).toHaveText([
    'Your name: This is required.',
    'Email: This is required.',
    'Department: Choose one.',
    'Message: This is required.',
  ]);
  await expect(page.getByLabel('Your name')).toHaveAccessibleDescription('This is required.');
  await axe(page);
  await summary.getByRole('link', { name: /^Email/ }).click();
  await expect(page.getByLabel('Email')).toBeFocused();

  // An answer clears its error as soon as it's fixed.
  await page.getByLabel('Email').fill('ada@example.edu');
  await expect(page.getByLabel('Email')).not.toHaveAttribute('aria-invalid');

  await fill(page);
  await page.getByRole('button', { name: 'Send' }).click();
  const sent = page.locator('#vesper-form-contact-sent');
  await expect(sent).toBeFocused();
  await expect(page).toHaveURL(/\/contact\/$/);
  await axe(page);
  const { submissions, sent: emails } = await state();
  expect(submissions[0]).toMatchObject({
    status: 'new',
    spam: 'ham',
    values: { name: 'Ada Lovelace' },
  });
  expect(emails.at(-1)).toMatchObject({
    kind: 'notification',
    to: 'desk@example.edu',
    replyTo: 'ada@example.edu',
  });
});

test('every state fits 320 pixels and 200% zoom without scrolling sideways', async ({ page }) => {
  for (const viewport of [
    { width: 320, height: 640 },
    // 200% zoom of a 1280-pixel window.
    { width: 640, height: 400 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto('/contact/');
    await page.getByRole('button', { name: 'Send' }).click();
    await expect(page.locator('[data-vesper-form-summary]')).toBeFocused();
    const wide = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(wide).toBeLessThanOrEqual(viewport.width);
    await axe(page);
  }
});

test('Tab reaches each control once, in order, and never the honeypot', async ({ page }) => {
  await page.goto('/contact/');
  // From the link just before the form: the last of the page's own.
  await page.getByRole('link', { name: 'welcome@example.com' }).focus();
  const reached: string[] = [];
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press('Tab');
    reached.push(
      await page.evaluate(() => {
        const element = document.activeElement as HTMLInputElement | null;
        return element?.closest('.vesper-form')
          ? element.name || element.textContent || ''
          : 'outside';
      }),
    );
  }
  expect(reached.slice(0, 7)).toEqual([
    'name',
    'email',
    'phone',
    'department',
    'message',
    'updates',
    'Send',
  ]);
  expect(reached).not.toContain('_vesper_hp');
});

test('blocks spam: a filled honeypot keeps nothing, and Akismet’s spam is kept as spam and sends nothing', async ({
  page,
}) => {
  const before = await state();
  await page.goto('/contact/');
  await fill(page);
  await page.locator('input[name="_vesper_hp"]').fill('cheap pills', { force: true });
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.locator('#vesper-form-contact-sent')).toBeFocused();
  expect((await state()).submissions.length).toBe(before.submissions.length);

  await page.goto('/contact/');
  await fill(page, { name: 'akismet-guaranteed-spam' });
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.locator('#vesper-form-contact-sent')).toBeFocused();
  const after = await state();
  expect(after.submissions[0]).toMatchObject({ status: 'spam', spam: 'spam' });
  expect(after.sent.length).toBe(before.sent.length);
});

test('sends Admissions to one address and everything else to another', async ({ page }) => {
  await setUp({
    rules: [
      {
        id: 'admissions',
        when: { field: 'department', op: 'is', value: 'admissions' },
        notify: ['admissions@example.edu'],
      },
    ],
  });
  const before = (await state()).sent.length;
  for (const department of ['Admissions', 'Registrar']) {
    await page.goto('/contact/');
    await fill(page, { department });
    await page.getByRole('button', { name: 'Send' }).click();
    await expect(page.locator('#vesper-form-contact-sent')).toBeFocused();
  }
  expect((await state()).sent.slice(before).map((one) => one.to)).toEqual([
    'admissions@example.edu',
    'desk@example.edu',
  ]);
});

test('a confirmation goes to the submitter, echoing only fields safe to echo', async ({ page }) => {
  await setUp({
    replyTo: 'desk@example.edu',
    confirmation: { subject: 'Thanks, {name}', body: 'Dear {name}, you wrote: {message}' },
  });
  const before = (await state()).sent.length;
  await page.goto('/contact/');
  await fill(page);
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.locator('#vesper-form-contact-sent')).toBeFocused();
  const confirmation = (await state()).sent
    .slice(before)
    .find((one) => one.kind === 'confirmation');
  expect(confirmation).toMatchObject({
    to: 'ada@example.edu',
    replyTo: 'desk@example.edu',
    subject: 'Thanks, Ada Lovelace',
    text: 'Dear Ada Lovelace, you wrote: ',
  });
});

test('a paused form says so on first focus, before anyone types', async ({ page }) => {
  await setUp({ paused: true });
  await page.goto('/contact/');
  await page.getByLabel('Your name').focus();
  const note = page.getByText('This form isn’t taking submissions right now.');
  await expect(note).toBeFocused();
  await expect(page.getByLabel('Your name')).toHaveCount(0);
  await axe(page);
  await setUp({ paused: false });
});
