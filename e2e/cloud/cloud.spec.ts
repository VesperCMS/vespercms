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
  // The cloud's picture, from the API's own origin (DECISIONS.md, "The user menu shows the person's picture").
  await expect(page.getByRole('button', { name: 'Ada Admin' }).locator('img')).toHaveAttribute(
    'src',
    /\/api\/avatars\/u_admin\.svg$/,
  );
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
  const title = page.getByRole('textbox', { name: 'Title' });
  await expect(title).toHaveValue('Harbor at dawn');
  await title.fill('Harbor at dawn, drafted');
  await expect(page.getByText(/^Draft saved/)).toBeVisible();
  // A draft is never a commit.
  expect(github.log()).toHaveLength(commits);
  expect(text(HARBOR)).toBe(before);

  await page.getByRole('button', { name: 'Publish', exact: true }).click();
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
  const title = page.getByRole('textbox', { name: 'Title' });
  await expect(title).toHaveValue('Harbor at dawn, drafted');
  await title.fill('Harbor at dawn, reviewed');
  await expect(page.getByRole('button', { name: 'Publish', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Request review' }).click();
  const dialog = page.getByRole('dialog', { name: 'Request review' });
  await dialog.getByRole('textbox', { name: 'Note for the approver (optional)' }).fill('New title');
  await axe(page);
  await dialog.getByRole('button', { name: 'Send for review' }).click();
  await expect(
    page.getByText('Sent for review. An approver will publish it or ask for changes.'),
  ).toBeVisible();

  // The approver follows the email's link, in a browser of their own, and
  // lands in Changes once signed in.
  const { emails } = (await control('state')) as { emails: { to: string; url: string }[] };
  const link = emails.findLast((e) => e.to === 'ada@example.edu')?.url ?? '';
  expect(link).toMatch(/\/admin\/#\/changes$/);
  const approver = await (await browser.newContext()).newPage();
  const commits = github.log().length;
  await control('sign-in-as', { id: 'u_admin' });
  await approver.goto(link);
  await approver.getByRole('button', { name: 'Sign in with Vesper' }).click();
  const drawer = approver.getByRole('dialog', { name: 'Changes' });
  await expect(drawer).toBeVisible();
  const review = drawer.getByRole('article', { name: /^Cal Contributor asked/ });
  await expect(review.getByText('New title')).toBeVisible();
  await axe(approver);
  await review.getByRole('button', { name: 'Publish', exact: true }).click();
  await expect(drawer.getByText('Published 1 change.')).toBeVisible();
  expect(github.log()).toHaveLength(commits + 1);
  expect(text(HARBOR)).toContain('title: Harbor at dawn, reviewed\n');
  await approver.context().close();
});

test('publishes two people’s drafts as one commit that credits each of them', async ({
  page,
  browser,
}) => {
  // Cal drafts one post in a browser of their own; Ada drafts another and
  // publishes both from Changes.
  const cal = await (
    await browser.newContext({ baseURL: test.info().project.use.baseURL })
  ).newPage();
  await signIn(cal, 'u_contributor', '#/c/blog/e/welcome');
  await cal.getByRole('textbox', { name: 'Title' }).fill('Welcome to the playground, by Cal');
  await expect(cal.getByText(/^Draft saved/)).toBeVisible();
  await cal.context().close();

  await signIn(page, 'u_admin', '#/c/blog/e/harbor-at-dawn');
  const title = page.getByRole('textbox', { name: 'Title' });
  await expect(title).toHaveValue('Harbor at dawn, reviewed');
  await title.fill('Harbor at dawn, by Ada');
  await expect(page.getByText(/^Draft saved/)).toBeVisible();
  const commits = github.log().length;
  // Home, among panes: the drafts waiting are beside the collections, which stay the page.
  await page.goto('/admin/#/');
  const waiting = page.getByRole('region', { name: 'Changes' });
  await expect(waiting.getByText('2 drafts are waiting to be published.')).toBeVisible();
  await expect(page.getByRole('main', { name: 'Content' })).toBeVisible();
  await axe(page);
  await waiting.getByRole('button', { name: 'See changes' }).click();
  const drawer = page.getByRole('dialog', { name: 'Changes' });
  await drawer.getByRole('button', { name: 'Publish 2 changes' }).click();
  await expect(drawer.getByText('Published 2 changes.')).toBeVisible();
  const log = github.log();
  expect(log).toHaveLength(commits + 1);
  expect(log[0]?.author).toBe('vesper[bot]');
  // The publisher first, then each draft's author, at no-reply addresses.
  expect(log[0]?.message).toBe(
    [
      'Update "Welcome to the playground, by Cal" in Blog posts, and 1 more change',
      '',
      'Vesper-Collection: blog',
      'Vesper-Editor: u_admin',
      'Vesper-Editor: u_contributor',
      'Co-authored-by: Ada Admin <u_admin@users.noreply.vesper.test>',
      'Co-authored-by: Cal Contributor <u_contributor@users.noreply.vesper.test>',
    ].join('\n'),
  );
  expect(log[0]?.changed).toEqual([`M\t${HARBOR}`, 'M\tsrc/content/blog/welcome.md']);
});

test('shows a change published elsewhere beside the draft, and keeps the draft on request', async ({
  page,
}) => {
  await signIn(page, 'u_admin', '#/c/blog/e/harbor-at-dawn');
  const title = page.getByRole('textbox', { name: 'Title' });
  await title.fill('Harbor at dawn, mine');
  await expect(page.getByText(/^Draft saved/)).toBeVisible();
  github.commitFiles(
    { [HARBOR]: text(HARBOR).replace(/title: .*\n/, 'title: Harbor at dawn, theirs\n') },
    'Elsewhere',
    'someone-else',
  );
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  const compare = page.getByRole('region', {
    name: 'Someone published this entry since your draft began',
  });
  await expect(compare.getByLabel('Published now')).toContainText('Harbor at dawn, theirs');
  await expect(compare.getByLabel('Your draft')).toContainText('Harbor at dawn, mine');
  await axe(page);
  await compare.getByRole('button', { name: 'Keep my draft' }).click();
  await expect(page.getByText(/Your draft is kept/)).toBeVisible();
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  await expect(page.getByText('Published. The site is building now.')).toBeVisible();
  expect(text(HARBOR)).toContain('title: Harbor at dawn, mine\n');
});

test('keeps unsaved changes on this device while the cloud is down, through a reload', async ({
  page,
}) => {
  await signIn(page, 'u_admin', '#/c/blog/e/harbor-at-dawn');
  const title = page.getByRole('textbox', { name: 'Title' });
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

// Scheduled publishing in the cloud (spec §6.17, Phase 4.5's criterion 1 here):
// the fake cloud's scheduling clock is moved on, and what fell due runs.
const COMMENCEMENT = 'src/content/events/spring-commencement.md';
const BOOK_SALE = 'src/content/events/book-sale.md';
type ScheduleState = {
  holds: { at: string; state: string }[];
  rebuilds: { at: string; via: string }[];
  dispatches: { event_type: string; client_payload: { at?: string } }[];
};
/** A time to the minute, as the Schedule dialog keeps it. */
const minute = (ms: number) => new Date(Math.ceil(ms / 60_000) * 60_000);
/** That time as the dialog takes it: wall time in the site's zone. */
const siteWall = (at: Date) =>
  new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
    .format(at)
    .replace(' ', 'T');

test('rebuilds at a scheduled time through the workflow’s dispatch, once', async ({ page }) => {
  await control('schedule', { trigger: 'dispatch', holdScheduledDrafts: false });
  const at = minute(Date.now() + 5 * 60_000);
  await signIn(page, 'u_admin', '#/c/events/e/spring-commencement');
  await page.getByRole('textbox', { name: 'Title' }).fill('Spring commencement, 2027');
  // Publishing waits for the draft: pressed while it saves, it does nothing (PLAN.md).
  await expect(page.getByRole('main').getByRole('status').first()).toHaveText(/Draft saved/);
  await page.getByRole('button', { name: 'More ways to publish' }).click();
  await page.getByRole('menuitem', { name: 'Schedule…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Schedule' });
  await dialog.getByLabel('Comes down (optional)').fill(siteWall(at));
  // With a trigger, the cloud keeps the time exactly.
  await expect(dialog.getByText(/^Comes down at \w{3}, \w{3} \d+, /)).toBeVisible();
  await axe(page);
  await dialog.getByRole('button', { name: 'Schedule' }).click();
  await expect.poll(() => text(COMMENCEMENT)).toContain('unpublishAt: ');
  expect(((await control('state')) as ScheduleState).rebuilds).toEqual([]);

  await control('advance', { ms: 10 * 60_000 });
  const state = (await control('state')) as ScheduleState;
  expect(state.rebuilds).toEqual([{ at: at.toISOString(), via: 'dispatch' }]);
  expect(state.dispatches).toEqual([
    { event_type: 'vesper-rebuild', client_payload: { at: at.toISOString() } },
  ]);
});

test('holds a scheduled draft in Vesper, and publishes it as one commit at its time', async ({
  page,
}) => {
  await control('schedule', { trigger: 'dispatch', holdScheduledDrafts: true });
  // Later than the clock the last test moved on.
  const at = minute(Date.now() + 30 * 60_000);
  github.commitFiles(
    {
      [BOOK_SALE]: `---\ntitle: Book sale\nsummary: Used books.\nstartsAt: 2027-05-15T10:00:00-04:00\nlocation: main-campus\npublishAt: ${at.toISOString()}\n---\n\nBooks.\n`,
    },
    'Add “Book sale” in Events',
    'developer',
  );
  await signIn(page, 'u_admin', '#/c/events/e/book-sale');
  await expect(page.getByRole('main').getByRole('status').first()).toHaveText(/^Scheduled · /);
  await page.getByRole('textbox', { name: 'Title' }).fill('Book sale, all week');
  await expect(page.getByRole('main').getByRole('status').first()).toHaveText(/Draft saved/);
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  await expect(
    page.getByText(/^Scheduled\. Vesper keeps it as a draft until .+, then publishes it\.$/),
  ).toBeVisible();
  const commits = github.log().length;
  expect(text(BOOK_SALE)).toContain('title: Book sale\n');

  await control('advance', { ms: 40 * 60_000 });
  expect(github.log()).toHaveLength(commits + 1);
  expect(github.log()[0]?.message).toMatch(/\nVesper-Editor: u_admin\n/);
  expect(text(BOOK_SALE)).toContain('title: Book sale, all week\n');
  const state = (await control('state')) as ScheduleState;
  expect(state.holds.at(-1)).toMatchObject({ state: 'started', at: at.toISOString() });
  // Its publish starts the site's build, so no rebuild is asked for beside it.
  expect(state.dispatches).toHaveLength(1);
});
