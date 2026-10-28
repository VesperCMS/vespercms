// A fake GitHub for GitHub mode's tests (spec §6.8): the REST, GraphQL and
// OAuth endpoints Vesper uses, over a real bare git repository through the
// git CLI. Blob SHAs, trees, commits and fast-forward refusals are git's own,
// so the storage contract runs against the real rules, not a model of them.
//
// - In process: `createGitHubFake({ dir })` gives `handle(request)` and
//   `fetch`, plus helpers to seed the repository, commit as someone else,
//   protect the branch or run out of rate limit.
// - As a server: `node scripts/github-fake.mjs --serve 4403 --dir <bare repo>
//   [--seed <folder>]` for the studio's e2e tests. The OAuth relay is served
//   by e2e/github/relay-server.mjs, which runs the real relay against this.
//
// It answers CORS as GitHub does (`Access-Control-Allow-Origin: *`), checks
// the token on every API call, and signs any user in at once on
// `/login/oauth/authorize`, so tests never see a GitHub page.
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, Accept, X-GitHub-Api-Version',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, PUT, DELETE',
  'Access-Control-Expose-Headers': 'ETag, X-RateLimit-Remaining, X-RateLimit-Reset, Retry-After',
};

/**
 * @param {{
 *   dir: string,
 *   owner?: string,
 *   repo?: string,
 *   branch?: string,
 *   token?: string,
 *   login?: string,
 *   push?: boolean,
 *   private?: boolean,
 * }} options
 */
export function createGitHubFake(options) {
  const owner = options.owner ?? 'vesper';
  const repo = options.repo ?? 'site';
  const branch = options.branch ?? 'main';
  const login = options.login ?? 'editor';
  const state = {
    token: options.token ?? 'gho_test-token',
    push: options.push ?? true,
    private: options.private !== false,
    /** Off, the repository answers 404, as it does to a GitHub App's sign-in before the app is installed there. */
    installed: true,
    protected: false,
    rateLimited: false,
    truncate: false,
    /** Runs once before the next ref update, as if someone else pushed just then. */
    beforeRefUpdate: null,
    /** OAuth codes waiting to be exchanged, with their PKCE challenge. */
    codes: new Map(),
    /** `repository_dispatch` events sent to the repository, as its workflows would receive them. */
    dispatches: [],
    /** Every request, for tests that count them. */
    log: [],
  };
  const dir = options.dir;

  if (!existsGit(dir))
    git(['init', '--bare', '--quiet', `--initial-branch=${branch}`, dir], { cwd: tmpdir() });

  /** Runs git in the bare repository, as the fake user. */
  function git(args, extra = {}) {
    return execFileSync('git', args, {
      cwd: extra.cwd ?? dir,
      input: extra.input,
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: extra.author ?? login,
        GIT_AUTHOR_EMAIL: `${extra.author ?? login}@users.noreply.example`,
        GIT_COMMITTER_NAME: extra.author ?? login,
        GIT_COMMITTER_EMAIL: `${extra.author ?? login}@users.noreply.example`,
        ...(extra.index ? { GIT_INDEX_FILE: extra.index } : {}),
      },
      maxBuffer: 256 * 1024 * 1024,
    });
  }
  const text = (args, extra) => git(args, extra).toString('utf8').trim();

  // Starting git costs about 25 ms on Windows, and the studio reads every
  // file through here, so a process per blob read and per ref read took most
  // of the cloud tests' time there (October 2026). A blob never changes for
  // its SHA, so each is read from git once, and many at a time.
  const blobs = new Map();

  /** Blobs by SHA in one git process, `null` for any the repository doesn't have. */
  function readBlobs(shas) {
    const wanted = [...new Set(shas)].filter((sha) => !blobs.has(sha));
    if (wanted.length > 0) {
      // Each answer is `<sha> <type> <size>\n<bytes>\n`, or `<sha> missing\n`.
      const out = git(['cat-file', '--batch'], { input: `${wanted.join('\n')}\n` });
      let at = 0;
      for (const sha of wanted) {
        const end = out.indexOf(0x0a, at);
        const [, type, size] = out.subarray(at, end).toString('utf8').split(' ');
        at = end + 1;
        if (type === 'missing') continue;
        if (type === 'blob') blobs.set(sha, out.subarray(at, at + Number(size)));
        at += Number(size) + 1;
      }
    }
    return shas.map((sha) => (blobs.has(sha) ? Buffer.from(blobs.get(sha)) : null));
  }

  function head() {
    // The ref's own file, where git keeps one; packed refs go through git.
    try {
      const tip = readFileSync(join(dir, 'refs', 'heads', ...branch.split('/')), 'utf8').trim();
      if (/^[0-9a-f]{40}$/.test(tip)) return tip;
    } catch {
      // Not a loose ref.
    }
    try {
      return text(['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]);
    } catch {
      return null;
    }
  }

  /** A tree from a base and changes: `{ path: bytes | null }`, null removing it. */
  function writeTree(base, changes) {
    const scratch = mkdtempSync(join(tmpdir(), 'vesper-fake-index-'));
    const index = join(scratch, 'index');
    try {
      if (base) git(['read-tree', base], { index });
      else git(['read-tree', '--empty'], { index });
      // --index-info works in a bare repository; mode 0 removes the path.
      const lines = changes.map((change) =>
        change.sha === null
          ? `0 ${'0'.repeat(40)}\t${change.path}`
          : `${change.mode ?? '100644'} ${change.sha}\t${change.path}`,
      );
      if (lines.length > 0)
        git(['update-index', '--index-info'], { index, input: `${lines.join('\n')}\n` });
      return text(['write-tree'], { index });
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  }

  function blob(bytes) {
    const sha = text(['hash-object', '-w', '--stdin'], { input: Buffer.from(bytes) });
    blobs.set(sha, Buffer.from(bytes));
    return sha;
  }

  /**
   * Commits files straight to the branch, as someone else pushing would:
   * `{ path: contents | null }`, null deleting it.
   */
  function commitFiles(files, message = 'Change from elsewhere', author = 'someone-else') {
    const parent = head();
    const base = parent ? text(['rev-parse', `${parent}^{tree}`]) : null;
    const changes = Object.entries(files).map(([path, contents]) => ({
      path,
      sha:
        contents === null
          ? null
          : blob(typeof contents === 'string' ? Buffer.from(contents) : contents),
    }));
    const tree = writeTree(base, changes);
    const commit = text(['commit-tree', tree, ...(parent ? ['-p', parent] : []), '-F', '-'], {
      input: message,
      author,
    });
    git(['update-ref', `refs/heads/${branch}`, commit]);
    return commit;
  }

  /** Seeds the branch with a folder's files (e.g. a copy of the playground), under `prefix`. */
  function seedFolder(
    folder,
    prefix = '',
    skip = new Set(['node_modules', 'dist', '.astro', '.vesper']),
  ) {
    const files = {};
    const walk = (current) => {
      for (const name of readdirSync(current)) {
        if (skip.has(name)) continue;
        const full = join(current, name);
        if (statSync(full).isDirectory()) walk(full);
        else {
          const path = relative(folder, full).split(sep).join('/');
          files[prefix ? `${prefix}/${path}` : path] = readFileSync(full);
        }
      }
    };
    walk(folder);
    const commit = commitFiles(files, 'Seed', login);
    // Tests copy a seeded repository per test: packed, it's 25 files instead
    // of one per object, and the copy took 180 ms on Windows, not 30.
    git(['repack', '-a', '-d', '-q']);
    return commit;
  }

  /** The branch's files as `{ path: bytes }`, for tests to compare byte for byte. */
  function files() {
    const tip = head();
    if (!tip) return {};
    const entries = text(['ls-tree', '-r', tip])
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [meta, path] = line.split('\t');
        return { path, sha: meta.split(' ')[2] };
      });
    const bytes = readBlobs(entries.map((entry) => entry.sha));
    return Object.fromEntries(entries.map((entry, i) => [entry.path, bytes[i]]));
  }

  /** Commits on the branch, newest first, with the files each changed. */
  function log() {
    const tip = head();
    if (!tip) return [];
    return text(['log', '--format=%H%x00%an%x00%B%x01', tip])
      .split('\x01')
      .map((record) => record.trim())
      .filter(Boolean)
      .map((record) => {
        const [sha, author, message] = record.split('\x00');
        const changed = text([
          'diff-tree',
          '--root',
          '--no-commit-id',
          '--name-status',
          '-r',
          '-M',
          sha,
        ])
          .split('\n')
          .filter(Boolean);
        return { sha, author, message: message.trim(), changed };
      });
  }

  function json(status, body, headers = {}) {
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS, ...headers },
    });
  }

  async function handle(request) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/api\/v3/, '');
    state.log.push(`${request.method} ${path}${url.search}`);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

    // GitHub's image host serves pictures to anyone; the fake serves the editor's.
    if (path === `/avatars/${login}` && request.method === 'GET') {
      const svg =
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#63ccc0"/><circle cx="32" cy="26" r="12" fill="#282019"/><rect x="14" y="42" width="36" height="22" rx="11" fill="#282019"/></svg>';
      return new Response(svg, { headers: { 'Content-Type': 'image/svg+xml', ...CORS } });
    }

    // OAuth, as GitHub's web flow does it: sign in and approve at once.
    if (path === '/login/oauth/authorize') {
      const code = randomBytes(10).toString('hex');
      state.codes.set(code, {
        challenge: url.searchParams.get('code_challenge'),
        redirect: url.searchParams.get('redirect_uri'),
      });
      const back = new URL(url.searchParams.get('redirect_uri') ?? '/');
      back.searchParams.set('code', code);
      back.searchParams.set('state', url.searchParams.get('state') ?? '');
      return new Response(null, { status: 302, headers: { Location: back.href } });
    }
    if (path === '/login/oauth/access_token' && request.method === 'POST') {
      // No CORS here, as on GitHub: only a relay can read the answer.
      const raw = await request.text();
      const body = request.headers.get('content-type')?.includes('json')
        ? JSON.parse(raw || '{}')
        : Object.fromEntries(new URLSearchParams(raw));
      const waiting = state.codes.get(body.code);
      if (!waiting || !body.client_secret) {
        return new Response(JSON.stringify({ error: 'bad_verification_code' }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }
      state.codes.delete(body.code);
      const challenge = createHash('sha256')
        .update(body.code_verifier ?? '')
        .digest('base64url');
      if (waiting.challenge && waiting.challenge !== challenge) {
        return new Response(JSON.stringify({ error: 'invalid_grant' }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(
        JSON.stringify({
          access_token: state.token,
          token_type: 'bearer',
          expires_in: 28800,
          scope: '',
        }),
        { headers: { 'Content-Type': 'application/json' } },
      );
    }

    if (request.headers.get('authorization') !== `Bearer ${state.token}`) {
      return json(401, { message: 'Bad credentials' });
    }
    if (state.rateLimited) {
      return json(
        403,
        { message: 'API rate limit exceeded' },
        {
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': String(Math.floor(Date.now() / 1000) + 600),
        },
      );
    }

    if (path === '/user') {
      const avatar = new URL(`/avatars/${login}`, url.origin).href;
      return json(200, { login, name: 'Test Editor', avatar_url: avatar });
    }
    if (path === '/graphql' && request.method === 'POST') {
      const { query } = await request.json();
      const objects = [...query.matchAll(/(\w+): object\(oid: "([0-9a-f]{40})"\)/g)];
      const bytes = readBlobs(objects.map(([, , oid]) => oid));
      const repository = {};
      for (const [i, [, alias]] of objects.entries()) {
        const blob = bytes[i];
        if (!blob) {
          repository[alias] = null;
          continue;
        }
        const decoded = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
        try {
          repository[alias] = { text: decoded.decode(blob), isBinary: false };
        } catch {
          repository[alias] = { text: null, isBinary: true };
        }
      }
      return json(200, { data: { repository } });
    }

    const match = new RegExp(`^/repos/${owner}/${repo}(/.*)?$`).exec(path);
    if (!match || !state.installed) return json(404, { message: 'Not Found' });
    const rest = match[1] ?? '';

    if (rest === '' && request.method === 'GET') {
      return json(200, {
        full_name: `${owner}/${repo}`,
        default_branch: branch,
        private: state.private,
        permissions: { admin: false, push: state.push, pull: true },
      });
    }
    let found;
    if ((found = /^\/git\/ref\/heads\/(.+)$/.exec(rest)) && request.method === 'GET') {
      const tip = head();
      if (decodeURIComponent(found[1]) !== branch || !tip)
        return json(404, { message: 'Not Found' });
      return json(200, { ref: `refs/heads/${branch}`, object: { sha: tip, type: 'commit' } });
    }
    if ((found = /^\/git\/commits\/([0-9a-f]{40})$/.exec(rest)) && request.method === 'GET') {
      const tree = text(['rev-parse', `${found[1]}^{tree}`]);
      return json(200, { sha: found[1], tree: { sha: tree } });
    }
    if ((found = /^\/git\/trees\/([0-9a-f]{40})$/.exec(rest)) && request.method === 'GET') {
      const recursive = url.searchParams.get('recursive') === '1';
      if (recursive && state.truncate) {
        return json(200, { sha: found[1], tree: [], truncated: true });
      }
      const lines = text(['ls-tree', '-l', ...(recursive ? ['-r', '-t'] : []), found[1]])
        .split('\n')
        .filter(Boolean);
      const tree = lines.map((line) => {
        const [meta, entryPath] = line.split('\t');
        const [mode, type, sha, size] = meta.split(/\s+/);
        return {
          path: entryPath,
          mode,
          type,
          sha,
          ...(type === 'blob' ? { size: Number(size) } : {}),
        };
      });
      return json(200, { sha: found[1], tree, truncated: false });
    }
    if ((found = /^\/git\/blobs\/([0-9a-f]{40})$/.exec(rest)) && request.method === 'GET') {
      const [bytes] = readBlobs([found[1]]);
      if (!bytes) return json(404, { message: 'Not Found' });
      if ((request.headers.get('accept') ?? '').includes('raw')) {
        return new Response(bytes, {
          status: 200,
          headers: { 'Content-Type': 'application/octet-stream', ...CORS },
        });
      }
      return json(200, { sha: found[1], content: bytes.toString('base64'), encoding: 'base64' });
    }
    if (rest === '/git/blobs' && request.method === 'POST') {
      const body = await request.json();
      const bytes =
        body.encoding === 'base64'
          ? Buffer.from(body.content, 'base64')
          : Buffer.from(body.content);
      return json(201, { sha: blob(bytes) });
    }
    if (rest === '/git/trees' && request.method === 'POST') {
      if (!state.push) return json(404, { message: 'Not Found' });
      const body = await request.json();
      const tree = writeTree(
        body.base_tree ?? null,
        body.tree.map((entry) => ({ path: entry.path, mode: entry.mode, sha: entry.sha })),
      );
      return json(201, { sha: tree });
    }
    if (rest === '/git/commits' && request.method === 'POST') {
      const body = await request.json();
      const commit = text(
        ['commit-tree', body.tree, ...body.parents.flatMap((p) => ['-p', p]), '-F', '-'],
        {
          input: body.message,
        },
      );
      return json(201, { sha: commit });
    }
    if ((found = /^\/git\/refs\/heads\/(.+)$/.exec(rest)) && request.method === 'PATCH') {
      const body = await request.json();
      const before = state.beforeRefUpdate;
      state.beforeRefUpdate = null;
      if (before) before();
      if (state.protected) {
        return json(422, { message: 'Changes must be made through a pull request.' });
      }
      const current = head();
      if (!body.force && current) {
        try {
          git(['merge-base', '--is-ancestor', current, body.sha]);
        } catch {
          return json(422, { message: 'Update is not a fast forward' });
        }
      }
      git(['update-ref', `refs/heads/${branch}`, body.sha]);
      return json(200, { ref: `refs/heads/${branch}`, object: { sha: body.sha, type: 'commit' } });
    }
    // The cloud's trigger for a scheduled rebuild (spec §6.17): GitHub answers 204.
    if (rest === '/dispatches' && request.method === 'POST') {
      if (!state.push) return json(404, { message: 'Not Found' });
      const body = await request.json();
      if (typeof body.event_type !== 'string' || body.event_type.length > 100) {
        return json(422, { message: 'Invalid request.' });
      }
      state.dispatches.push({
        event_type: body.event_type,
        client_payload: body.client_payload ?? {},
      });
      return new Response(null, { status: 204, headers: CORS });
    }
    return json(404, { message: 'Not Found' });
  }

  return {
    owner,
    repo,
    branch,
    login,
    state,
    handle,
    /** A `fetch` that answers from this fake, for tests in one process. */
    fetch: (input, init) => handle(input instanceof Request ? input : new Request(input, init)),
    head,
    commitFiles,
    seedFolder,
    files,
    log,
  };
}

function existsGit(dir) {
  try {
    return statSync(join(dir, 'HEAD')).isFile();
  } catch {
    return false;
  }
}

/** Serves a fake over HTTP, as the e2e tests use it. */
export function serveGitHubFake(fake, port, host = '127.0.0.1') {
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = chunks.length > 0 ? Buffer.concat(chunks) : undefined;
    const request = new Request(`http://${req.headers.host}${req.url}`, {
      method: req.method,
      headers: Object.entries(req.headers).flatMap(([key, value]) =>
        Array.isArray(value)
          ? value.map((v) => [key, v])
          : value === undefined
            ? []
            : [[key, value]],
      ),
      ...(body && req.method !== 'GET' && req.method !== 'HEAD' ? { body } : {}),
    });
    const response = await fake.handle(request);
    res.statusCode = response.status;
    response.headers.forEach((value, key) => res.setHeader(key, value));
    res.end(Buffer.from(await response.arrayBuffer()));
  });
  return new Promise((resolve) => server.listen(port, host, () => resolve(server)));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const arg = (name, fallback) => {
    const at = process.argv.indexOf(name);
    return at === -1 ? fallback : process.argv[at + 1];
  };
  const dir = arg('--dir', join(tmpdir(), `vesper-github-fake-${String(process.pid)}`));
  mkdirSync(dir, { recursive: true });
  const fake = createGitHubFake({ dir });
  const seed = arg('--seed', null);
  if (seed && !fake.head()) fake.seedFolder(seed, arg('--prefix', ''));
  const port = Number(arg('--serve', '4403'));
  await serveGitHubFake(fake, port);
  console.log(
    `github-fake: ${fake.owner}/${fake.repo} on http://127.0.0.1:${String(port)}/ (repository ${dir})`,
  );
}
