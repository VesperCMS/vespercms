import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { createGitHubFake } from '../../scripts/github-fake.mjs';

/*
 * GitHub mode (spec §6.8, Phase 3): a built playground on the plain static
 * server, signing in through the real relay and publishing to a fake
 * GitHub whose repository is real git (scripts/github-site.mjs). The
 * criterion: an editor with a GitHub account edits and publishes, with an
 * image, from a deployed static site, as one commit.
 *
 * The tests share the repository, so they run one at a time, in order.
 */

test.describe.configure({ mode: 'serial' });

const repository = fileURLToPath(new URL('../.github-site-repo.git', import.meta.url));
const fixtures = fileURLToPath(new URL('../../apps/playground/fixtures/uploads/', import.meta.url));
// The same bare repository the servers publish to, read with git directly.
const github = createGitHubFake({ dir: repository });
const WCAG21_AA = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const sha = (bytes: Uint8Array | undefined) =>
  bytes ? createHash('sha1').update(bytes).digest('hex') : null;

async function axe(page: Page): Promise<void> {
  const { violations } = await new AxeBuilder({ page }).withTags(WCAG21_AA).analyze();
  expect(
    violations.map(({ id, help, nodes }) => ({ id, help, targets: nodes.map((n) => n.target) })),
  ).toEqual([]);
}

async function signIn(page: Page, route = ''): Promise<void> {
  await page.goto(`/admin/${route}`);
  await page.getByRole('button', { name: 'Sign in with GitHub' }).click();
  // Only the signed-in studio has a skip link; the gate's screens don't. Not the
  // user menu: an editor's own bar has none, and it shows only while the entry loads.
  await expect(page.getByRole('link', { name: 'Skip to content' })).toBeAttached();
}

test('signs in through the relay, and every screen on the way passes axe', async ({ page }) => {
  await page.goto('/admin/');
  await expect(
    page.getByRole('heading', { level: 1, name: 'Sign in to edit this site' }),
  ).toBeVisible();
  await expect(
    page.getByText('You’ll publish to vesper/site on GitHub.', { exact: false }),
  ).toBeVisible();
  await axe(page);
  await page.getByRole('button', { name: 'Sign in with GitHub' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Content' })).toBeVisible();
  // The code and state never stay in the address.
  expect(new URL(page.url()).search).toBe('');
  await axe(page);
  // GitHub's picture beside the login, from GitHub's image host (here, the fake's).
  const account = page.getByRole('button', { name: '@editor' });
  await expect(account.locator('img')).toHaveAttribute('src', /\/avatars\/editor\?s=64$/);
  await expect
    .poll(() => account.locator('img').evaluate((img: HTMLImageElement) => img.naturalWidth))
    .toBeGreaterThan(0);
  // By keyboard: Enter opens the menu on Appearance's first option; End reaches Sign out.
  await account.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('menuitemradio', { name: 'System' })).toBeFocused();
  await page.keyboard.press('End');
  await expect(page.getByRole('menuitem', { name: 'Sign out of GitHub' })).toBeFocused();
  await axe(page);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Sign in with GitHub' })).toBeVisible();
});

test('says the app may not be installed when GitHub can’t find the repository', async ({
  page,
}) => {
  // GitHub answers a GitHub App's sign-in 404 for a repository the app isn't installed on.
  const repo = (url: URL) => url.pathname.endsWith('/repos/vesper/site');
  await page.route(repo, (route) =>
    route.fulfill({
      status: 404,
      json: { message: 'Not Found' },
      headers: { 'Access-Control-Allow-Origin': '*' },
    }),
  );
  await page.goto('/admin/');
  await page.getByRole('button', { name: 'Sign in with GitHub' }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'GitHub can’t find this site’s repository' }),
  ).toBeVisible();
  await expect(page.getByText(/can’t change this site/)).toHaveCount(0);
  await axe(page);
  // The owner installs the app, then tries again by keyboard.
  await page.unroute(repo);
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Try again' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Sign out of GitHub' })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('link', { name: 'Skip to content' })).toBeAttached();
});

test('a deep link survives a reload while signed in', async ({ page }) => {
  await signIn(page, '#/c/blog');
  await expect(page.getByRole('button', { name: '@editor' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: 'Blog posts' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: 'Blog posts' })).toBeVisible();
});

test('publishes an edit and a new image as one commit, changing nothing else', async ({ page }) => {
  const before = github.files();
  const commits = github.log().length;
  await signIn(page, '#/c/blog/e/harbor-at-dawn');
  const title = page.getByRole('textbox', { name: 'Title' });
  await expect(title).toHaveValue('Harbor at dawn');
  await title.fill('Harbor at dawn, from GitHub');

  await page.getByRole('button', { name: 'Replace image' }).click();
  const dialog = page.getByRole('dialog', { name: 'Choose an image' });
  await dialog.locator('input[type=file]').setInputFiles(`${fixtures}portrait-exif-6.jpg`);
  await expect(dialog).toBeHidden();
  // Held for the publish: nothing is committed yet.
  expect(github.log()).toHaveLength(commits);

  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  await expect(
    page.getByText('Published. It will be live after the site is next built.'),
  ).toBeVisible();

  const log = github.log();
  expect(log).toHaveLength(commits + 1);
  expect(log[0]?.author).toBe('editor');
  expect(log[0]?.message).toMatch(
    /^Update "Harbor at dawn, from GitHub" in Blog posts\n\nVesper-Collection: blog$/,
  );
  expect(log[0]?.changed.sort()).toEqual([
    'A\tsrc/assets/blog/portrait-exif-6.jpg',
    'M\tsrc/content/blog/harbor-at-dawn.md',
  ]);
  const after = github.files();
  for (const [path, bytes] of Object.entries(before)) {
    if (path === 'src/content/blog/harbor-at-dawn.md') continue;
    expect(sha(after[path]), path).toBe(sha(bytes));
  }
  const post = new TextDecoder().decode(after['src/content/blog/harbor-at-dawn.md']);
  expect(post).toContain('title: Harbor at dawn, from GitHub\n');
  expect(post).toContain('src: ../../assets/blog/portrait-exif-6.jpg\n');
});

test('a duplicate publishes as one commit that adds the copy, from the original’s text', async ({
  page,
}) => {
  const original = 'src/content/blog/welcome.md';
  const before = new TextDecoder().decode(github.files()[original]);
  const commits = github.log().length;
  await signIn(page, '#/c/blog/e/welcome');
  await expect(page.getByRole('textbox', { name: 'Title' })).toHaveValue(
    'Welcome to the playground',
  );
  await page.getByRole('button', { name: 'More actions for Welcome to the playground' }).click();
  await page.getByRole('menuitem', { name: 'Duplicate' }).click();
  await expect(page.getByRole('textbox', { name: 'Title' })).toHaveValue(
    'Welcome to the playground (copy)',
  );
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  await expect(page).toHaveURL(/#\/c\/blog\/e\/welcome-to-the-playground-copy$/);

  const log = github.log();
  expect(log).toHaveLength(commits + 1);
  expect(log[0]?.message).toBe(
    'Add "Welcome to the playground (copy)" to Blog posts\n\nVesper-Collection: blog',
  );
  expect(log[0]?.changed).toEqual(['A\tsrc/content/blog/welcome-to-the-playground-copy.md']);
  expect(
    new TextDecoder().decode(github.files()['src/content/blog/welcome-to-the-playground-copy.md']),
  ).toBe(
    before.replace(
      'title: "Welcome to the playground"',
      'title: "Welcome to the playground (copy)"',
    ),
  );
});

test('scheduling when an event comes down publishes one commit of just its times', async ({
  page,
}) => {
  const path = 'src/content/events/spring-commencement.md';
  const before = new TextDecoder().decode(github.files()[path]);
  const commits = github.log().length;
  await signIn(page, '#/c/events/e/spring-commencement');
  await expect(page.getByRole('textbox', { name: 'Title' })).toHaveValue('Spring commencement');
  await page.getByRole('button', { name: 'More ways to publish' }).click();
  await page.getByRole('menuitem', { name: 'Schedule…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Schedule' });
  await dialog.getByLabel('Comes down (optional)').fill('2099-06-01T17:00');
  await dialog.getByRole('button', { name: 'Schedule' }).click();
  await expect(
    page.getByText('Published. It will be live after the site is next built.'),
  ).toBeVisible();
  const log = github.log();
  expect(log).toHaveLength(commits + 1);
  expect(log[0]?.changed).toEqual([`M\t${path}`]);
  expect(new TextDecoder().decode(github.files()[path])).toBe(
    before.replace(
      'location: main-campus\n',
      'location: main-campus\nunpublishAt: 2099-06-01T17:00:00-04:00\n',
    ),
  );
});

test('reports a change published elsewhere as a conflict, and offers to reload', async ({
  page,
}) => {
  await signIn(page, '#/c/docs/e/getting-started');
  const title = page.getByRole('textbox', { name: 'Title' });
  await expect(title).toHaveValue('Getting started');
  // Someone else publishes the same entry meanwhile.
  const path = 'src/content/docs/getting-started.mdoc';
  const current = new TextDecoder().decode(github.files()[path]);
  github.commitFiles({
    [path]: current.replace('title: Getting started', 'title: Getting started now'),
  });
  await title.fill('Getting started here');
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  const alert = page.getByRole('alert').filter({ hasText: 'changed' });
  await expect(alert).toBeVisible();
  await alert.getByRole('button', { name: 'Reload this entry' }).click();
  await expect(title).toHaveValue('Getting started now');
});

test('a reorder in the page outline is one commit of the order file', async ({ page }) => {
  const commits = github.log().length;
  await signIn(page, '#/c/pages');
  const grid = page.getByRole('treegrid');
  await grid.getByRole('row', { name: 'About the college' }).focus();
  await page.keyboard.press('Alt+ArrowDown');
  await expect(page.locator('[role="status"][aria-live="polite"]')).toHaveText(
    'About the college moved down, position 2 of 5.',
  );
  const log = github.log();
  expect(log).toHaveLength(commits + 1);
  expect(log[0]?.changed).toEqual(['M\tsrc/content/pages/_order.yaml']);
});
