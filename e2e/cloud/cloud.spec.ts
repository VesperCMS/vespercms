import { fileURLToPath } from 'node:url';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { createGitHubFake } from '../../scripts/github-fake.mjs';

/*
 * The cloud (spec §6.9, Phase 4): a built playground on the plain static
 * server, connected to a fake cloud that keeps its drafts and publishes to a
 * fake GitHub whose repository is real git (scripts/cloud-site.mjs). The
 * criteria: an editor with no GitHub account drafts, requests review and is
 * published by an approver; the site works from a plain static host; and
 * with the cloud unreachable, unsaved work is kept.
 *
 * The tests share the repository, so they run one at a time, in order.
 */

test.describe.configure({ mode: 'serial' });

const CLOUD = 'http://127.0.0.1:4406';
const repository = fileURLToPath(new URL('../.cloud-site-repo.git', import.meta.url));
// The same bare repository the fake cloud publishes to, read with git directly.
const github = createGitHubFake({ dir: repository, login: 'vesper[bot]' });
const WCAG21_AA = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const HARBOR = 'src/content/blog/harbor-at-dawn.md';
const text = (path: string) => new TextDecoder().decode(github.files()[path]);

async function control(path: string, body?: unknown): Promise<unknown> {
  const response = await fetch(`${CLOUD}/__test/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return response.json();
}

async function axe(page: Page): Promise<void> {
  const { violations } = await new AxeBuilder({ page }).withTags(WCAG21_AA).analyze();
  expect(
    violations.map(({ id, help, nodes }) => ({ id, help, targets: nodes.map((n) => n.target) })),
  ).toEqual([]);
}

async function signIn(page: Page, person: string, route = ''): Promise<void> {
  await control('sign-in-as', { id: person });
  await page.goto(`/admin/${route}`);
  await page.getByRole('button', { name: 'Sign in with Vesper' }).click();
  // Only the signed-in studio has a skip link; the sign-in screens don't.
  await expect(page.getByRole('link', { name: 'Skip to content' })).toBeAttached();
}

test.afterEach(async () => {
  await control('down', { down: false });
});

test('signs in with Vesper, and every screen on the way passes axe', async ({ page }) => {
  await control('sign-in-as', { id: 'u_admin' });
  await page.goto('/admin/');
  await expect(
    page.getByRole('heading', { level: 1, name: 'Sign in to edit this site' }),
  ).toBeVisible();
  // Signed out, nothing of the cloud's features shows (spec §6.9).
  await expect(page.getByRole('button', { name: /changes?$/ })).toHaveCount(0);
  await axe(page);
  await page.getByRole('button', { name: 'Sign in with Vesper' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Content' })).toBeVisible();
  // The one-time code never stays in the address.
  expect(page.url()).not.toContain('code=');
  await axe(page);
  await page.getByRole('button', { name: 'Ada Admin' }).click();
  await expect(page.getByRole('menuitem', { name: 'Open dashboard' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Sign out of Vesper' })).toBeVisible();
  await axe(page);
});

test('stays signed in across a reload, with nothing in sessionStorage or localStorage', async ({
  page,
}) => {
  await signIn(page, 'u_admin', '#/c/blog');
  await expect(page.getByRole('heading', { level: 1, name: 'Blog posts' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: 'Blog posts' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Ada Admin' })).toBeVisible();
  // The key and its tokens live in IndexedDB; the key can't be read back out.
  const kept = await page.evaluate(() => ({
    local: Object.keys(localStorage),
    session: Object.keys(sessionStorage).filter((key) => key.startsWith('vesper.cloud')),
  }));
  expect(kept).toEqual({ local: [], session: [] });
});

test('finishes a sign-in in the tab an email link opens', async ({ page, context }) => {
  await control('sign-in-as', { id: 'u_admin' });
  await page.goto('/admin/#/c/blog');
  // The real app emails a sign-in link, and the mail client opens it in a new
  // tab: the site's localStorage, but a sessionStorage of its own. The fake
  // signs in at once, so its redirect back is held here and opened in a new tab.
  let callback = '';
  await page.route(/\/app\/authorize\?/, async (route) => {
    const answer = await route.fetch({ maxRedirects: 0 });
    callback = answer.headers()['location'] ?? '';
    await route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><title>Check your email</title><h1>Check your email</h1>',
    });
  });
  await page.getByRole('button', { name: 'Sign in with Vesper' }).click();
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();
  expect(callback).toContain('/admin/#/callback?code=');
  const tab = await context.newPage();
  await tab.goto(callback);
  await expect(tab.getByRole('heading', { level: 1, name: 'Blog posts' })).toBeVisible();
  await expect(tab.getByRole('button', { name: 'Ada Admin' })).toBeVisible();
  expect(tab.url()).not.toContain('code=');
});

test('saves a draft as the editor types, and publishes it as one commit by the app', async ({
  page,
}) => {
  const before = text(HARBOR);
  const commits = github.log().length;
  await signIn(page, 'u_admin', '#/c/blog/e/harbor-at-dawn');
  const title = page.getByRole('textbox', { name: 'Title (required)' });
  await expect(title).toHaveValue('Harbor at dawn');
  await title.fill('Harbor at dawn, drafted');
  await expect(page.getByText(/^Draft saved/)).toBeVisible();
  // A draft is never a commit.
  expect(github.log()).toHaveLength(commits);
  expect(text(HARBOR)).toBe(before);

  await page.getByRole('button', { name: 'Publish' }).click();
  // The host has started building the commit (the fake reports so at once).
  await expect(page.getByText('Published. The site is building now.')).toBeVisible();
  const log = github.log();
  expect(log).toHaveLength(commits + 1);
  expect(log[0]?.author).toBe('vesper[bot]');
  expect(log[0]?.message).toBe(
    'Update "Harbor at dawn, drafted" in Blog posts\n\nVesper-Collection: blog\nVesper-Editor: u_admin\nCo-authored-by: Ada Admin <u_admin@users.noreply.vesper.test>',
  );
  expect(log[0]?.changed).toEqual([`M\t${HARBOR}`]);
  expect(text(HARBOR)).toContain('title: Harbor at dawn, drafted\n');

  // The host reports the build, and the studio says so.
  await control('deploy', { commit: log[0]?.sha, state: 'live' });
  await expect(page.getByText('Published. It’s live on the site.')).toBeVisible({
    timeout: 15_000,
  });
});

test('a contributor requests review, and an approver publishes it from Changes', async ({
  page,
  browser,
}) => {
  await signIn(page, 'u_contributor', '#/c/blog/e/harbor-at-dawn');
  const title = page.getByRole('textbox', { name: 'Title (required)' });
  await expect(title).toHaveValue('Harbor at dawn, drafted');
  await title.fill('Harbor at dawn, reviewed');
  await expect(page.getByRole('button', { name: 'Publish' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Request review' }).click();
  const dialog = page.getByRole('dialog', { name: 'Request review' });
  await dialog.getByRole('textbox', { name: 'Note for the approver (optional)' }).fill('New title');
  await axe(page);
  await dialog.getByRole('button', { name: 'Send for review' }).click();
  await expect(
    page.getByText('Sent for review. An approver will publish it or ask for changes.'),
  ).toBeVisible();

  // The approver, in a browser of their own.
  const approver = await (await browser.newContext()).newPage();
  const commits = github.log().length;
  await signIn(approver, 'u_admin');
  await approver.getByRole('button', { name: '1 change, 1 to review' }).click();
  const drawer = approver.getByRole('dialog', { name: 'Changes' });
  const review = drawer.getByRole('article', { name: /^Cal Contributor asked/ });
  await expect(review.getByText('New title')).toBeVisible();
  await axe(approver);
  await review.getByRole('button', { name: 'Publish' }).click();
  await expect(drawer.getByText('Published 1 change.')).toBeVisible();
  expect(github.log()).toHaveLength(commits + 1);
  expect(text(HARBOR)).toContain('title: Harbor at dawn, reviewed\n');
  await approver.context().close();
});

test('shows a change published elsewhere beside the draft, and keeps the draft on request', async ({
  page,
}) => {
  await signIn(page, 'u_admin', '#/c/blog/e/harbor-at-dawn');
  const title = page.getByRole('textbox', { name: 'Title (required)' });
  await title.fill('Harbor at dawn, mine');
  await expect(page.getByText(/^Draft saved/)).toBeVisible();
  github.commitFiles(
    { [HARBOR]: text(HARBOR).replace(/title: .*\n/, 'title: Harbor at dawn, theirs\n') },
    'Elsewhere',
    'someone-else',
  );
  await page.getByRole('button', { name: 'Publish' }).click();
  const compare = page.getByRole('region', {
    name: 'Someone published this entry since your draft began',
  });
  await expect(compare.getByLabel('Published now')).toContainText('Harbor at dawn, theirs');
  await expect(compare.getByLabel('Your draft')).toContainText('Harbor at dawn, mine');
  await axe(page);
  await compare.getByRole('button', { name: 'Keep my draft' }).click();
  await expect(page.getByText(/Your draft is kept/)).toBeVisible();
  await page.getByRole('button', { name: 'Publish' }).click();
  await expect(page.getByText('Published. The site is building now.')).toBeVisible();
  expect(text(HARBOR)).toContain('title: Harbor at dawn, mine\n');
});

test('keeps unsaved changes on this device while the cloud is down, through a reload', async ({
  page,
}) => {
  await signIn(page, 'u_admin', '#/c/blog/e/harbor-at-dawn');
  const title = page.getByRole('textbox', { name: 'Title (required)' });
  await expect(title).toHaveValue('Harbor at dawn, mine');
  await control('down', { down: true });
  await title.fill('Harbor at dawn, offline');
  await expect(page.getByText('Can’t reach Vesper. Kept on this device')).toBeVisible();

  // A reload while it's down: the studio says so, and nothing is lost.
  await page.reload();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Vesper couldn’t be reached' }),
  ).toBeVisible();
  await axe(page);
  await control('down', { down: false });
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(title).toHaveValue('Harbor at dawn, offline');
  await expect(
    page.getByText('Your unsaved changes were kept on this device, and are back.'),
  ).toBeVisible();
  await expect(page.getByText(/^Draft saved/)).toBeVisible();
  const state = (await control('state')) as { drafts: { files: string[] }[] };
  expect(state.drafts.flatMap((d) => d.files)).toContain(HARBOR);
});
