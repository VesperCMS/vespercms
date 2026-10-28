# Vesper's GitHub sign-in relay

GitHub mode lets editors sign in with their own GitHub account on your deployed site and publish from `/admin`. GitHub's sign-in needs one call that a browser can't make and that needs your app's secret, so it goes through this relay: one Cloudflare Worker, no dependencies, and nothing stored.

The free plan of Cloudflare Workers is plenty. A `workers.dev` address works; you don't need a domain.

## 1. Create a GitHub App

On GitHub, go to **Settings → Developer settings → GitHub Apps → New GitHub App** (for an organization: the organization's settings).

- **GitHub App name:** something editors will recognize, such as "Highlands College website".
- **Homepage URL:** your site.
- **Callback URL:** your relay's address followed by `/callback`, for example `https://vesper-github-relay.your-account.workers.dev/callback`. You'll know the address after step 3; you can come back and fill it in.
- Leave **Expire user authorization tokens** on. Tokens last 8 hours; Vesper never keeps a refresh token.
- **Request user authorization (OAuth) during installation:** off.
- **Webhook:** untick **Active**. The relay doesn't use webhooks.
- **Repository permissions:** **Contents: Read and write**. Metadata (read) is added on its own. Nothing else.
- **Where can this GitHub App be installed?** "Only on this account" is enough for your own sites. An agency that installs it on client accounts picks "Any account".

Then:

- note the **Client ID** (it starts with `Iv`);
- under **Client secrets**, click **Generate a new client secret** and copy it;
- click **Install App** and install it on the site's repository only.

The app does nothing until it's installed on the repository. Until then GitHub doesn't show the repository to anyone signing in through it, and `/admin` says "GitHub can't find this site's repository". Install it, then choose **Try again** there.

Editors also need write access to the repository: add them as collaborators. Vesper's tokens reach only repositories where the app is installed, and only what each editor could already change.

## 2. Configure the relay

Copy this folder. In `wrangler.toml`:

- `GITHUB_CLIENT_ID`: the Client ID from step 1.
- `ALLOWED_ORIGINS`: every address editors open `/admin` from, as whole origins (`https://example.edu`), separated by commas. Add a preview host one by one if editors use it.

## 3. Deploy it

```sh
npx wrangler login
npx wrangler secret put GITHUB_CLIENT_SECRET
npx wrangler deploy
```

`wrangler deploy` prints the relay's address. If you skipped the callback URL in step 1, set it now.

## 4. Turn on GitHub mode

In your site's `astro.config.mjs`:

```js
vesper({ github: { relay: 'https://vesper-github-relay.your-account.workers.dev' } })
```

The repository, its default branch and the site's folder in it are read from git at build. Set `repo: 'owner/name'`, `branch` or `root` if they can't be.

Build and deploy the site, open `/admin`, and choose **Sign in with GitHub**.

## Hosts that check who made a commit

In GitHub mode each editor is the author of their own commits. On private repositories:

- **Vercel** builds only commits by members of your team.
- **Netlify** holds commits by authors it doesn't recognize for approval.

Add your editors there too, or build with GitHub Actions or Cloudflare Pages, which don't check.

## How it works

1. `/authorize`: the studio arrives with your site's address, a random state and a PKCE challenge. The relay checks the site against `ALLOWED_ORIGINS` and sends the browser to GitHub.
2. `/callback`: GitHub sends the browser back here with a one-time code. The relay checks the site again and sends the code on to its `/admin/`.
3. `/token`: the studio posts the code and its PKCE verifier. Only now does the relay add the client secret and ask GitHub for a token, which goes back to the studio and nowhere else.

The verifier never leaves the editor's tab, so a code seen anywhere else is useless. The relay keeps no state and writes no logs of codes or tokens.
