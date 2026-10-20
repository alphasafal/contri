import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { clearMemory, setTransport } from '../../src/background/github';
import { createAuth, type Auth } from '../src/auth';
import { createCache } from '../src/cache';
import { createServer, VERSION } from '../src/server';
import { createContri, issueOf, repoOf } from '../src/tools';
import { createTransport } from '../src/transport';
import { fakeGitHub, isoAgo, json, repoJson } from '../../tests/unit/helpers';

const REPO = '/repos/acme/widgets';
const repoRoute = (url: URL) => (url.pathname === REPO ? json(repoJson()) : undefined);

const issueJson = (number: number, extra: Record<string, unknown> = {}) => ({
  number,
  title: `Issue ${number}`,
  html_url: `https://github.com/acme/widgets/issues/${number}`,
  state: 'open',
  created_at: isoAgo(10),
  body: 'Something is broken.',
  user: { login: 'reporter' },
  assignees: [],
  labels: [{ name: 'good first issue' }],
  comments: 0,
  ...extra,
});

/** One open issue on acme/widgets, with optional comments and timeline. */
function issueRoutes(number: number, comments: unknown[] = [], timeline: unknown[] = []) {
  return [
    repoRoute,
    (u: URL) =>
      u.pathname === `${REPO}/issues/${number}` ? json(issueJson(number, { comments: comments.length })) : undefined,
    (u: URL) => (u.pathname === `${REPO}/issues/${number}/comments` ? json(comments) : undefined),
    (u: URL) => (u.pathname === `${REPO}/issues/${number}/timeline` ? json(timeline) : undefined),
  ];
}

const anonymous = () => createContri({ cache: createCache() });

beforeEach(() => clearMemory());

describe('input parsing', () => {
  it('accepts issue URLs, bare github.com paths and owner/name#123', () => {
    expect(issueOf('https://github.com/acme/widgets/issues/12')).toEqual({ repo: 'acme/widgets', number: 12 });
    expect(issueOf('github.com/acme/widgets/issues/12#issuecomment-1')).toEqual({ repo: 'acme/widgets', number: 12 });
    expect(issueOf(' acme/widgets#7 ')).toEqual({ repo: 'acme/widgets', number: 7 });
  });
  it('rejects pull requests, other hosts and non-repository paths', () => {
    expect(() => issueOf('https://github.com/acme/widgets/pull/12')).toThrow(/not a GitHub issue/);
    expect(() => issueOf('https://gitlab.com/acme/widgets/issues/12')).toThrow(/not a GitHub issue/);
    expect(() => issueOf('settings/profile#3')).toThrow(/not a GitHub issue/);
    expect(() => issueOf('acme/widgets#0')).toThrow(/not a GitHub issue/);
  });
  it('normalizes repositories and keeps qualifiers out', () => {
    expect(repoOf('https://github.com/acme/widgets.git')).toBe('acme/widgets');
    expect(() => repoOf('acme/widgets repo:evil/x')).toThrow(/not a public GitHub repository/);
  });
});

describe('cache', () => {
  it('reuses fresh reports, keeps partial ones for a third of the time, and joins identical requests', async () => {
    let now = 0;
    const cache = createCache(() => now);
    const load = vi.fn(async () => ({ warnings: [] }));
    await Promise.all([cache.get('insight', { n: 1 }, false, load), cache.get('insight', { n: 1 }, false, load)]);
    expect(load).toHaveBeenCalledTimes(1);
    now = 9 * 60_000;
    await cache.get('insight', { n: 1 }, false, load);
    expect(load).toHaveBeenCalledTimes(1);
    now = 11 * 60_000;
    await cache.get('insight', { n: 1 }, false, load);
    expect(load).toHaveBeenCalledTimes(2);

    const partial = vi.fn(async () => ({ warnings: ['Partly checked'] }));
    await cache.get('overview', {}, false, partial);
    now += 11 * 60_000; // past 30 min / 3
    await cache.get('overview', {}, false, partial);
    expect(partial).toHaveBeenCalledTimes(2);
  });
  it('keeps signed-in and anonymous reports apart, and force skips the cache', async () => {
    const cache = createCache();
    const load = vi.fn(async () => ({}));
    await cache.get('team', {}, false, load);
    await cache.get('team', {}, true, load);
    await cache.get('team', {}, true, load, true);
    expect(load).toHaveBeenCalledTimes(3);
  });
  it('cancels a shared request only when every caller has cancelled', async () => {
    const cache = createCache();
    let seen: AbortSignal | undefined;
    let finish!: (v: unknown) => void;
    const load = vi.fn((signal: AbortSignal) => {
      seen = signal;
      return new Promise((resolve) => (finish = resolve));
    });
    const a = new AbortController();
    const b = new AbortController();
    const first = cache.get('insight', { n: 2 }, false, load, false, a.signal);
    const second = cache.get('insight', { n: 2 }, false, load, false, b.signal);
    expect(load).toHaveBeenCalledTimes(1);
    a.abort();
    expect(seen!.aborted).toBe(false);
    finish({ ok: true });
    await expect(second).resolves.toEqual({ ok: true });
    await expect(first).resolves.toEqual({ ok: true });

    const c = new AbortController();
    const d = new AbortController();
    void cache.get('insight', { n: 3 }, false, load, false, c.signal).catch(() => {});
    void cache.get('insight', { n: 3 }, false, load, false, d.signal).catch(() => {});
    c.abort();
    d.abort();
    expect(seen!.aborted).toBe(true);
  });
  it('a new call after everyone cancelled starts a fresh request instead of joining the cancelled one', async () => {
    const cache = createCache();
    const load = vi.fn(
      (signal: AbortSignal) =>
        new Promise((resolve, reject) => {
          signal.addEventListener('abort', () => setTimeout(() => reject(new Error('aborted')), 50));
          setTimeout(() => resolve({ n: load.mock.calls.length }), 20);
        }),
    );
    const a = new AbortController();
    const first = cache.get('insight', { n: 9 }, false, load, false, a.signal).catch((e: Error) => e.message);
    a.abort();
    await expect(cache.get('insight', { n: 9 }, false, load)).resolves.toEqual({ n: 2 });
    expect(load).toHaveBeenCalledTimes(2);
    await first;
  });
  it('does not cache failures', async () => {
    const cache = createCache();
    const load = vi.fn().mockRejectedValueOnce(new Error('down')).mockResolvedValueOnce({ ok: true });
    await expect(cache.get('repo', {}, false, load)).rejects.toThrow('down');
    await expect(cache.get('repo', {}, false, load)).resolves.toEqual({ ok: true });
  });
  it('forgets maintainer rosters after a week', () => {
    let now = 0;
    const cache = createCache(() => now);
    cache.saveRoster('Acme/Widgets', [{ login: 'maya', basis: ['owner'] }]);
    expect(cache.loadRoster('acme/widgets')).toHaveLength(1);
    now = 8 * 86_400_000;
    expect(cache.loadRoster('acme/widgets')).toBeUndefined();
  });
});

describe('transport', () => {
  it('sends the token only to api.github.com', async () => {
    const base = vi.fn(async () =>
      json({}, 200, { 'x-ratelimit-remaining': '4999', 'x-ratelimit-reset': '2000000000' }),
    );
    const { fetcher, remaining } = createTransport('secret', base);
    await fetcher('https://api.github.com/repos/a/b');
    const headers = (base.mock.calls[0] as unknown as [string, RequestInit])[1].headers as Headers;
    expect(headers.get('authorization')).toBe('Bearer secret');
    expect(remaining().core.remaining).toBe(4999);
    await expect(fetcher('https://evil.example/repos/a/b')).rejects.toThrow(/only talks to api.github.com/);
    expect(base).toHaveBeenCalledTimes(1);
  });
  it('sends no Authorization header without a token', async () => {
    const base = vi.fn(async () => json({}));
    await createTransport(undefined, base).fetcher('https://api.github.com/rate_limit');
    const headers = (base.mock.calls[0] as unknown as [string, RequestInit])[1].headers as Headers;
    expect(headers.has('authorization')).toBe(false);
  });
  it('a cancelled request leaves the queue at once', async () => {
    const hold: Array<() => void> = [];
    const base = vi.fn(() => new Promise<Response>((r) => hold.push(() => r(json({})))));
    const { fetcher } = createTransport(undefined, base);
    void fetcher('https://api.github.com/a');
    void fetcher('https://api.github.com/b');
    const controller = new AbortController();
    const queued = fetcher('https://api.github.com/c', { signal: controller.signal });
    controller.abort();
    await expect(queued).rejects.toThrow(/Cancelled/);
    hold.forEach((go) => go());
    await new Promise((r) => setTimeout(r, 200));
    expect(base).toHaveBeenCalledTimes(2); // the cancelled one was never sent
  });
  it('stops sending after GitHub says to slow down', async () => {
    const base = vi.fn(async () => json({ message: 'slow' }, 429, { 'retry-after': '60' }));
    const { fetcher } = createTransport(undefined, base);
    await fetcher('https://api.github.com/repos/a/b');
    await expect(fetcher('https://api.github.com/repos/a/b')).rejects.toThrow(/slow down/);
    expect(base).toHaveBeenCalledTimes(1);
  });
  it('an anonymous rate-limit block does not stop a request after signing in', async () => {
    let token: string | undefined = undefined;
    const base = vi.fn(async (_url: string, init?: RequestInit) =>
      new Headers(init?.headers).has('authorization')
        ? json({}, 200, { 'x-ratelimit-remaining': '4999' })
        : json({ message: 'API rate limit exceeded' }, 403, {
            'x-ratelimit-remaining': '0',
            'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 3600),
          }),
    );
    const { fetcher, remaining } = createTransport({ token: () => token, reject: () => {} }, base);
    await fetcher('https://api.github.com/repos/a/b');
    await expect(fetcher('https://api.github.com/repos/a/b')).rejects.toThrow(/slow down/);
    expect(remaining().core.remaining).toBe(0);
    token = 'gho_signedin_now_0123456789';
    const response = await fetcher('https://api.github.com/repos/a/b');
    expect(response.status).toBe(200);
    expect(remaining().core.remaining).toBe(4999);
    expect(base).toHaveBeenCalledTimes(2);
  });

  it('drops a rejected token and retries the request anonymously', async () => {
    const base = vi.fn(async (_url: string, init?: RequestInit) =>
      new Headers(init?.headers).has('authorization') ? json({ message: 'Bad credentials' }, 401) : json({ ok: true }),
    );
    const reject = vi.fn();
    let token: string | undefined = 'expired';
    const { fetcher } = createTransport(
      {
        token: () => token,
        reject: (t) => {
          reject(t);
          token = undefined;
        },
      },
      base,
    );
    const response = await fetcher('https://api.github.com/repos/a/b');
    expect(response.status).toBe(200);
    expect(reject).toHaveBeenCalledWith('expired');
    await fetcher('https://api.github.com/repos/a/b');
    expect(base).toHaveBeenCalledTimes(3);
  });
});

describe('tools', () => {
  it('check_issue: an open, unclaimed issue with no linked PR looks free', async () => {
    setTransport(fakeGitHub(issueRoutes(5)).fetcher);
    const result = await anonymous().checkIssue({ issue: 'acme/widgets#5' });
    expect(result.verdict).toMatchObject({ tone: 'good', label: 'Looks free' });
    expect(result).not.toHaveProperty('linkedPullRequests');
    expect(result.linkCheck).toBe('clear');
    expect(result.github).toMatchObject({ signedIn: false });
    expect(result).not.toHaveProperty('thread');
  });

  it('check_issue: a recent comment claim gives a warning verdict, and the thread is opt-in', async () => {
    const claim = {
      user: { login: 'newbie' },
      author_association: 'NONE',
      created_at: isoAgo(1),
      html_url: 'https://github.com/acme/widgets/issues/6#issuecomment-1',
      body: "Hi! I'd like to work on this, could you assign it to me?",
    };
    setTransport(fakeGitHub(issueRoutes(6, [claim])).fetcher);
    const result = await anonymous().checkIssue({
      issue: 'https://github.com/acme/widgets/issues/6',
      includeThread: true,
    });
    expect(result.verdict).toMatchObject({ tone: 'warn', label: 'Claimed by @newbie' });
    expect(result.thread?.text).toContain('assign it to me');
    expect(result.thread?.note).toMatch(/untrusted/);
  });

  it('check_issue: an open pull request referencing the issue makes it busy', async () => {
    const timeline = [
      {
        event: 'cross-referenced',
        created_at: isoAgo(2),
        source: {
          issue: {
            number: 40,
            title: 'Fix it',
            html_url: 'https://github.com/acme/widgets/pull/40',
            state: 'open',
            draft: false,
            user: { login: 'sam' },
            pull_request: { merged_at: null },
            repository: { full_name: 'acme/widgets', private: false },
          },
        },
      },
    ];
    setTransport(fakeGitHub(issueRoutes(9, [], timeline)).fetcher);
    const result = await anonymous().checkIssue({ issue: 'acme/widgets#9' });
    expect(result.verdict).toMatchObject({ tone: 'busy', label: 'Open PR #40' });
  });

  it('check_issue: force fetches fresh data, past both caches', async () => {
    const comments: unknown[] = [];
    setTransport(fakeGitHub(issueRoutes(5, comments)).fetcher);
    const contri = anonymous();
    expect((await contri.checkIssue({ issue: 'acme/widgets#5' })).verdict.label).toBe('Looks free');
    comments.push({
      user: { login: 'newbie' },
      author_association: 'NONE',
      created_at: isoAgo(0.01),
      html_url: 'https://github.com/acme/widgets/issues/5#issuecomment-9',
      body: "I'd like to work on this, please assign it to me",
    });
    expect((await contri.checkIssue({ issue: 'acme/widgets#5' })).verdict.label).toBe('Looks free'); // cached
    expect((await contri.checkIssue({ issue: 'acme/widgets#5' }, { force: true })).verdict.label).toBe(
      'Claimed by @newbie',
    );
  });

  it('check_issue: answers repeat calls from the cache', async () => {
    const { fetcher, calls } = fakeGitHub(issueRoutes(5));
    setTransport(fetcher);
    const contri = anonymous();
    await contri.checkIssue({ issue: 'acme/widgets#5' });
    const first = calls.length;
    clearMemory();
    await contri.checkIssue({ issue: 'https://github.com/acme/widgets/issues/5' });
    expect(calls.length).toBe(first);
  });

  it('check_issue: re-checks once a maintainer roster is known, so claims are read with it', async () => {
    const { fetcher, calls } = fakeGitHub(issueRoutes(5));
    setTransport(fetcher);
    const cache = createCache();
    const contri = createContri({ cache });
    expect((await contri.checkIssue({ issue: 'acme/widgets#5' })).hint).toMatch(/team_responsiveness/);
    const first = calls.length;
    cache.saveRoster('acme/widgets', [{ login: 'maya', basis: ['owner'] }]);
    clearMemory();
    expect(await contri.checkIssue({ issue: 'acme/widgets#5' })).not.toHaveProperty('hint');
    expect(calls.length).toBeGreaterThan(first);
  });

  it('find_issues: defaults to unassigned beginner issues and never marks unchecked rows free', async () => {
    const { fetcher, calls } = fakeGitHub([
      repoRoute,
      (u) =>
        u.pathname === '/search/issues'
          ? json({
              total_count: 1,
              incomplete_results: false,
              items: [{ ...issueJson(3), updated_at: isoAgo(1), labels: [{ name: 'help wanted' }] }],
            })
          : undefined,
    ]);
    setTransport(fetcher);
    const result = await anonymous().findIssues({ repo: 'acme/widgets' });
    const search = calls.find((c) => c.includes('/search/issues'))!;
    expect(decodeURIComponent(search)).toContain('no:assignee');
    expect(decodeURIComponent(search).replace(/\+/g, ' ')).toContain('label:"good first issue","help wanted"');
    expect(result.items[0]).toEqual({
      number: 3,
      title: 'Issue 3',
      labels: ['help wanted'],
      comments: 0,
      updated: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    });
    expect(result.issueUrl).toBe('https://github.com/acme/widgets/issues/{number}');
    expect(result.note).toMatch(/check_issue/);
  });

  it('find_issues: returns 10 rows by default and says when there are more', async () => {
    setTransport(
      fakeGitHub([
        repoRoute,
        (u) =>
          u.pathname === '/search/issues'
            ? json({
                total_count: 25,
                incomplete_results: false,
                items: Array.from({ length: 25 }, (_, i) => ({ ...issueJson(100 + i), updated_at: isoAgo(i) })),
              })
            : undefined,
      ]).fetcher,
    );
    const contri = anonymous();
    const first = await contri.findIssues({ repo: 'acme/widgets' });
    expect(first).toMatchObject({ total: 25, shown: 10, hasMore: true });
    const all = await contri.findIssues({ repo: 'acme/widgets', limit: 30 });
    expect(all).toMatchObject({ shown: 25, hasMore: false });
  });

  it('check_issue: groups linked PRs by what they mean and drops other repositories from the notes', async () => {
    const xref = (n: number, state: 'open' | 'closed' | 'merged', repo = 'acme/widgets') => ({
      event: 'cross-referenced',
      created_at: isoAgo(2),
      source: {
        issue: {
          number: n,
          title: `PR ${n}`,
          html_url: `https://github.com/${repo}/pull/${n}`,
          state: state === 'open' ? 'open' : 'closed',
          draft: false,
          user: { login: `u${n}` },
          pull_request: { merged_at: state === 'merged' ? isoAgo(1) : null },
          repository: { full_name: repo, private: false },
        },
      },
    });
    setTransport(
      fakeGitHub(
        issueRoutes(11, [], [xref(1, 'closed'), xref(2, 'closed'), xref(3, 'merged'), xref(4, 'merged', 'other/x')]),
      ).fetcher,
    );
    const result = await anonymous().checkIssue({ issue: 'acme/widgets#11' });
    expect(result.linkedPullRequests).toEqual({
      merged: [{ number: 3, title: 'PR 3', url: 'https://github.com/acme/widgets/pull/3' }],
      closedWithoutMerge: [1, 2],
      otherRepositories: 1,
    });
    expect(result.verdict.tone).toBe('good');
    expect(result.verdict.detail).toMatch(/\(#3\) mentions it/);
    expect(result.verdict.detail).toMatch(/2 earlier pull requests \(#1, #2\) were closed without merging/);
    expect(result.verdict.detail).not.toMatch(/#4/);
  });

  it('sends the long sign-in note only when it changes', async () => {
    setTransport(fakeGitHub(issueRoutes(5)).fetcher);
    let note = 'Anonymous: offer sign_in.';
    const contri = createContri({
      auth: { signedIn: () => false, status: () => ({ signedIn: false, note }) },
      cache: createCache(),
      remaining: () => ({ core: { remaining: 5, reset: '2026-10-20T12:00:00.000Z' } }),
    });
    const first = await contri.checkIssue({ issue: 'acme/widgets#5' });
    expect(first.github).toEqual({
      signedIn: false,
      note,
      requestsLeft: { core: 5 },
      resetsAt: '2026-10-20T12:00:00.000Z',
    });
    expect((await contri.checkIssue({ issue: 'acme/widgets#5' })).github).not.toHaveProperty('note');
    note = 'GitHub rejected GITHUB_TOKEN.';
    expect((await contri.checkIssue({ issue: 'acme/widgets#5' })).github).toMatchObject({ note });
  });

  it('find_issues: rejects unknown labels', async () => {
    await expect(anonymous().findIssues({ repo: 'acme/widgets', label: 'wontfix' })).rejects.toThrow(/Label must be/);
  });

  it('contribution_brief: links the project documents and includes the evidence', async () => {
    setTransport(
      fakeGitHub([
        ...issueRoutes(5),
        (u) =>
          u.pathname === `${REPO}/community/profile`
            ? json({
                health_percentage: 85,
                files: {
                  readme: { html_url: 'https://github.com/acme/widgets/blob/main/README.md' },
                  contributing: { html_url: 'https://github.com/acme/widgets/blob/main/CONTRIBUTING.md' },
                  code_of_conduct: null,
                },
              })
            : undefined,
      ]).fetcher,
    );
    const result = await anonymous().contributionBrief({ issue: 'acme/widgets#5', task: 'plan' });
    expect(result.brief).toContain('Issue: #5 Issue 5');
    expect(result.brief).toContain('Claim status: none');
    expect(result.projectDocuments).toEqual([
      { name: 'README', url: 'https://github.com/acme/widgets/blob/main/README.md' },
      { name: 'Contributing guide', url: 'https://github.com/acme/widgets/blob/main/CONTRIBUTING.md' },
    ]);
    expect(result.communityHealth).toBe(85);
  });
});

/** Speaks raw JSON-RPC to the real SDK server, as an MCP client would over stdio. */
function connect(auth?: Auth) {
  const sent: Array<Record<string, unknown>> = [];
  const waiters = new Map<number, (m: Record<string, unknown>) => void>();
  const transport = {
    onmessage: undefined as undefined | ((m: unknown) => void),
    onclose: undefined as undefined | (() => void),
    onerror: undefined as undefined | ((e: Error) => void),
    async start() {},
    async send(message: Record<string, unknown>) {
      sent.push(message);
      waiters.get(message.id as number)?.(message);
    },
    async close() {
      transport.onclose?.();
    },
  };
  const handle = serveStdio(
    () => createServer(auth ? createContri({ auth, cache: createCache() }) : anonymous(), auth),
    { transport: transport as never },
  );
  let id = 0;
  const request = (method: string, params: Record<string, unknown> = {}) =>
    new Promise<Record<string, unknown>>((resolve) => {
      const n = ++id;
      waiters.set(n, resolve);
      transport.onmessage!({ jsonrpc: '2.0', id: n, method, params });
    });
  return { request, notify: (method: string) => transport.onmessage!({ jsonrpc: '2.0', method }), handle };
}

describe('MCP server', () => {
  it('declares the version from its package.json', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };
    expect(VERSION).toBe(pkg.version);
  });

  it('lists six read-only tools and two prompts, and returns tool errors as results', async () => {
    const { request, notify, handle } = connect();
    const init = (await request('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'test', version: '1' },
    })) as { result: { serverInfo: { name: string }; instructions: string } };
    expect(init.result.serverInfo.name).toBe('contri');
    expect(init.result.instructions).toMatch(/check_issue/);
    notify('notifications/initialized');

    const tools = (await request('tools/list')) as {
      result: { tools: Array<{ name: string; annotations: { readOnlyHint: boolean } }> };
    };
    expect(tools.result.tools.map((t) => t.name)).toEqual([
      'check_issue',
      'repo_health',
      'team_responsiveness',
      'find_issues',
      'discover_projects',
      'contribution_brief',
    ]);
    expect(tools.result.tools.every((t) => t.annotations.readOnlyHint)).toBe(true);

    const prompts = (await request('prompts/list')) as { result: { prompts: Array<{ name: string }> } };
    expect(prompts.result.prompts.map((p) => p.name)).toEqual(['find_first_issue', 'can_i_take_this']);

    const bad = (await request('tools/call', { name: 'check_issue', arguments: { issue: 'acme/widgets/pull/3' } })) as {
      result: { isError: boolean; content: Array<{ text: string }> };
    };
    expect(bad.result.isError).toBe(true);
    expect(bad.result.content[0].text).toMatch(/not a GitHub issue/);

    setTransport(fakeGitHub(issueRoutes(5)).fetcher);
    const ok = (await request('tools/call', { name: 'check_issue', arguments: { issue: 'acme/widgets#5' } })) as {
      result: {
        isError?: boolean;
        structuredContent: { verdict: { label: string } };
        content: Array<{ text: string }>;
      };
    };
    expect(ok.result.isError).toBeFalsy();
    expect(ok.result.structuredContent.verdict.label).toBe('Looks free');
    expect(JSON.parse(ok.result.content[0].text).verdict.label).toBe('Looks free');
    await handle.close();
  });

  it('with sign-in available: says how to sign in, and sign_in returns the code and link to show', async () => {
    const auth = createAuth({
      env: {},
      file: join(mkdtempSync(join(tmpdir(), 'contri-srv-')), 'creds.json'),
      fetcher: async (url) =>
        url.endsWith('/login/device/code')
          ? json({
              device_code: 'd',
              user_code: 'ABCD-1234',
              verification_uri: 'https://github.com/login/device',
              interval: 5,
            })
          : json({ error: 'authorization_pending' }),
    });
    const { request, notify, handle } = connect(auth);
    await request('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 't', version: '1' },
    });
    notify('notifications/initialized');
    const tools = (await request('tools/list')) as { result: { tools: Array<{ name: string }> } };
    expect(tools.result.tools.map((t) => t.name)).toEqual(expect.arrayContaining(['sign_in', 'sign_out']));

    setTransport(fakeGitHub(issueRoutes(5)).fetcher);
    const check = (await request('tools/call', { name: 'check_issue', arguments: { issue: 'acme/widgets#5' } })) as {
      result: { structuredContent: { github: { signedIn: boolean; note: string } } };
    };
    expect(check.result.structuredContent.github).toMatchObject({ signedIn: false });
    expect(check.result.structuredContent.github.note).toMatch(/sign_in/);

    const signIn = (await request('tools/call', { name: 'sign_in', arguments: {} })) as {
      result: { structuredContent: { signInPending: { code: string; url: string }; message: string } };
    };
    expect(signIn.result.structuredContent.signInPending).toEqual(
      expect.objectContaining({ code: 'ABCD-1234', url: 'https://github.com/login/device' }),
    );
    await handle.close();
  });
});
