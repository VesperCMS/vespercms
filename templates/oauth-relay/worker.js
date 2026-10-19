// Vesper's GitHub sign-in relay (spec §6.8): one Cloudflare Worker, no
// dependencies, no storage. GitHub's token endpoint can't be called from a
// browser and needs the app's secret, so this holds the secret and does that
// one call. Everything else stays in the studio's tab.
//
//   GET  /authorize  from the studio: checks the site, then on to GitHub
//   GET  /callback   from GitHub: back to the site's /admin/ with the code
//   POST /token      from the studio: the code and its PKCE verifier, for a token
//
// Settings (wrangler.toml and `wrangler secret put`):
//   GITHUB_CLIENT_ID      the GitHub App's client ID
//   GITHUB_CLIENT_SECRET  the GitHub App's client secret (a secret)
//   ALLOWED_ORIGINS       sites that may sign in through this relay, comma-separated:
//                         https://example.edu,https://www.example.edu
//   GITHUB_URL            optional: https://github.example.com on GitHub Enterprise Server
//
// The studio sends a PKCE challenge and keeps the verifier, so a code that
// leaks from an address is useless to anyone else. Tokens are never logged
// or kept here.

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const allowed = allowedOrigins(env.ALLOWED_ORIGINS);
    const github = (env.GITHUB_URL || 'https://github.com').replace(/\/+$/, '');
    const callback = `${url.origin}/callback`;
    try {
      if (url.pathname === '/authorize' && request.method === 'GET') {
        return authorize(url, env, allowed, github, callback);
      }
      if (url.pathname === '/callback' && request.method === 'GET') {
        return back(url, allowed);
      }
      if (url.pathname === '/token') {
        const origin = request.headers.get('Origin') || '';
        if (!allowed.has(origin)) return text(403, 'This site may not sign in through this relay.');
        if (request.method === 'OPTIONS')
          return new Response(null, { status: 204, headers: cors(origin) });
        if (request.method === 'POST') return token(request, env, origin, github, callback);
      }
      return text(404, 'Not found.');
    } catch {
      return text(500, 'The sign-in relay had a problem.');
    }
  },
};

function allowedOrigins(value) {
  const origins = new Set();
  for (const item of String(value || '').split(',')) {
    try {
      origins.add(new URL(item.trim()).origin);
    } catch {
      // Not an origin; ignored.
    }
  }
  return origins;
}

/** The studio's way in: a site on the list, a state and a PKCE challenge, then GitHub. */
function authorize(url, env, allowed, github, callback) {
  const returnTo = parseUrl(url.searchParams.get('return'));
  const state = url.searchParams.get('state') || '';
  const challenge = url.searchParams.get('code_challenge') || '';
  if (!returnTo || !allowed.has(returnTo.origin)) {
    return text(403, 'This site may not sign in through this relay.');
  }
  if (!/^[\w-]{8,200}$/.test(state) || !/^[\w-]{43,128}$/.test(challenge)) {
    return text(400, 'This sign-in is missing what it needs. Start again from the site.');
  }
  const target = new URL(`${github}/login/oauth/authorize`);
  target.searchParams.set('client_id', env.GITHUB_CLIENT_ID);
  target.searchParams.set('redirect_uri', callback);
  // The site and the studio's own state travel through GitHub and back here.
  target.searchParams.set(
    'state',
    encodeState({ r: returnTo.origin + returnTo.pathname, s: state }),
  );
  target.searchParams.set('code_challenge', challenge);
  target.searchParams.set('code_challenge_method', 'S256');
  return redirect(target.href);
}

/** GitHub's answer, sent on to the site that asked, if it's still on the list. */
function back(url, allowed) {
  const state = decodeState(url.searchParams.get('state'));
  const returnTo = parseUrl(state?.r);
  if (!state || !returnTo || !allowed.has(returnTo.origin)) {
    return text(400, 'This sign-in didn’t come from a site this relay knows.');
  }
  const target = new URL(returnTo.origin + returnTo.pathname);
  const code = url.searchParams.get('code');
  if (code) target.searchParams.set('github', code);
  else target.searchParams.set('github_error', url.searchParams.get('error') || 'failed');
  target.searchParams.set('state', state.s);
  return redirect(target.href);
}

/** The code and verifier for a token: the one call that needs the secret. */
async function token(request, env, origin, github, callback) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json(400, { message: 'GitHub didn’t sign you in. Try again.' }, origin);
  }
  if (typeof body?.code !== 'string' || typeof body?.code_verifier !== 'string') {
    return json(400, { message: 'GitHub didn’t sign you in. Try again.' }, origin);
  }
  const response = await fetch(`${github}/login/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      client_id: env.GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
      code: body.code,
      code_verifier: body.code_verifier,
      redirect_uri: callback,
    }),
  });
  const answer = await response.json().catch(() => ({}));
  if (typeof answer.access_token !== 'string') {
    return json(400, { message: 'GitHub didn’t sign you in. Try again.' }, origin);
  }
  // Only the access token goes back. A refresh token, if GitHub sent one, is dropped.
  return json(
    200,
    { token: answer.access_token, expiresIn: Number(answer.expires_in) || 28800 },
    origin,
  );
}

function parseUrl(value) {
  try {
    const parsed = new URL(String(value));
    return parsed.protocol === 'https:' ||
      parsed.hostname === 'localhost' ||
      parsed.hostname === '127.0.0.1'
      ? parsed
      : null;
  } catch {
    return null;
  }
}

function encodeState(value) {
  return btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decodeState(value) {
  try {
    const padded = String(value).replace(/-/g, '+').replace(/_/g, '/');
    const parsed = JSON.parse(atob(padded));
    return typeof parsed?.r === 'string' && typeof parsed?.s === 'string' ? parsed : null;
  } catch {
    return null;
  }
}

function cors(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  };
}

const common = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' };

function redirect(location) {
  return new Response(null, { status: 302, headers: { ...common, Location: location } });
}

function text(status, message) {
  return new Response(message, {
    status,
    headers: { ...common, 'Content-Type': 'text/plain; charset=utf-8' },
  });
}

function json(status, body, origin) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...common, ...cors(origin), 'Content-Type': 'application/json' },
  });
}
