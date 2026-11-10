import { createServer } from 'node:https';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { blankPage, issuePage, issuesListPage, repoPage } from './mock-pages';

/**
 * A tiny fake of github.com + api.github.com served over HTTPS. Chromium is pointed
 * at it with --host-resolver-rules, so the installed extension talks to it exactly
 * as it would to GitHub.
 */

const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString();
const REPO = 'acme/widgets';

const repoJson = {
  full_name: REPO,
  name: 'widgets',
  owner: { login: 'acme', type: 'Organization' },
  html_url: `https://github.com/${REPO}`,
  description: 'Widgets for everyone',
  private: false,
  fork: false,
  archived: false,
  disabled: false,
  pushed_at: ago(1),
  stargazers_count: 1234,
  forks_count: 56,
  language: 'TypeScript',
  license: { name: 'MIT License' },
  has_issues: true,
  topics: ['widgets'],
  default_branch: 'main',
};

const issue7 = {
  number: 7,
  title: 'Fix the widget crash',
  html_url: `https://github.com/${REPO}/issues/7`,
  state: 'open',
  created_at: ago(90),
  updated_at: ago(2),
  body: 'The widget crashes when opened twice.',
  user: { login: 'reporter' },
  assignees: [],
  labels: [{ name: 'good first issue' }],
  comments: 2,
};

const AUTHORS = ['ana', 'ben', 'omar', 'lena', 'kai', 'mia', 'raj', 'zoe', 'li', 'sam'];
/** 42 merged PRs spread over 90 days, busier recently, for a realistic weekly chart. */
const MERGES = Array.from({ length: 42 }, (_, i) => {
  const days = Math.round(Math.pow(i / 42, 1.3) * 86) + 1;
  return {
    number: 100 - i,
    html_url: `https://github.com/acme/widgets/pull/${100 - i}`,
    created_at: ago(days + 1 + (i % 3)),
    merged_at: ago(days),
    user: { login: AUTHORS[i % AUTHORS.length] },
  };
});

const COMMITS = Array.from({ length: 64 }, (_, i) => ({
  author: { login: AUTHORS[(i * 3) % AUTHORS.length] },
  html_url: `https://github.com/acme/widgets/commit/${i}`,
  commit: { author: { date: ago(1 + Math.floor(i * 1.3)) } },
}));

/** Outside-contributor PRs and issues for the Team sample (hours until a maintainer replied). */
const SAMPLE: Record<
  number,
  { pr: boolean; title: string; author: string; created: string; replyHours: number | null; replier: string }
> = {
  30: {
    pr: true,
    title: 'Add docs for the widget API',
    author: 'newbie',
    created: ago(6),
    replyHours: 6,
    replier: 'quietmaint',
  },
  31: {
    pr: true,
    title: 'Fix typo in README',
    author: 'lena',
    created: ago(12),
    replyHours: 20,
    replier: 'quietmaint',
  },
  32: { pr: true, title: 'Support dark tooltips', author: 'omar', created: ago(20), replyHours: 3, replier: 'ana' },
  33: { pr: true, title: 'Speed up rendering', author: 'kai', created: ago(3), replyHours: null, replier: '' },
  40: { pr: false, title: 'Crash on Safari', author: 'mia', created: ago(8), replyHours: 10, replier: 'quietmaint' },
  41: { pr: false, title: 'How do I theme widgets?', author: 'raj', created: ago(15), replyHours: 30, replier: 'ana' },
  42: {
    pr: false,
    title: 'Docs link is broken',
    author: 'zoe',
    created: ago(25),
    replyHours: 2,
    replier: 'quietmaint',
  },
  43: { pr: false, title: 'Feature: keyboard shortcuts', author: 'li', created: ago(4), replyHours: 5, replier: 'ana' },
};

function rest(path: string, query: URLSearchParams): unknown | undefined {
  const base = `/repos/${REPO}`;
  if (path === base) return repoJson;
  if (path === `${base}/pulls`) return MERGES;
  if (path === `${base}/commits`) return COMMITS;
  if (path === `${base}/releases/latest`)
    return {
      name: 'v1.2.0',
      tag_name: 'v1.2.0',
      html_url: 'https://github.com/acme/widgets/releases/1',
      published_at: ago(20),
    };
  if (path === `${base}/community/profile`)
    return {
      health_percentage: 85,
      files: {
        readme: { html_url: 'https://github.com/acme/widgets#readme' },
        contributing: { html_url: 'https://github.com/acme/widgets/CONTRIBUTING.md' },
      },
    };
  if (path === `${base}/issues/events`)
    return [
      {
        event: 'labeled',
        actor: { login: 'quietmaint' },
        created_at: ago(2),
        issue: { user: { login: 'someone' }, created_at: ago(9) },
      },
      // ana is a private org member: GitHub shows her as CONTRIBUTOR, but she merges PRs.
      {
        event: 'merged',
        actor: { login: 'ana' },
        created_at: ago(3),
        issue: { user: { login: 'omar' }, created_at: ago(20) },
      },
    ];
  if (path === `${base}/contents/.github/CODEOWNERS`) return null;
  if (path === `${base}/issues/7`) return issue7;
  if (path === `${base}/issues/7/timeline`) return [];
  if (path === `${base}/issues/7/comments`)
    return [
      {
        user: { login: 'sam' },
        author_association: 'NONE',
        created_at: ago(45),
        html_url: `${issue7.html_url}#c1`,
        body: "Hi! I'd like to work on this.",
      },
      {
        user: { login: 'quietmaint' },
        author_association: 'CONTRIBUTOR',
        created_at: ago(44),
        html_url: `${issue7.html_url}#c2`,
        body: 'Sure, go ahead.',
      },
    ];
  const sampleReply = /^\/repos\/acme\/widgets\/issues\/(\d+)\/comments$/.exec(path);
  if (sampleReply && SAMPLE[Number(sampleReply[1])]) {
    const item = SAMPLE[Number(sampleReply[1])];
    if (item.replyHours === null) return [];
    return [
      {
        user: { login: item.replier },
        author_association: 'CONTRIBUTOR',
        created_at: new Date(Date.parse(item.created) + item.replyHours * 3_600_000).toISOString(),
        html_url: `https://github.com/${REPO}/issues/${sampleReply[1]}#reply`,
        body: 'Thanks! Looking at this.',
      },
    ];
  }
  if (/^\/repos\/acme\/widgets\/pulls\/\d+\/reviews$/.test(path)) return [];
  if (path === '/search/issues') {
    const q = query.get('q') ?? '';
    if (q.includes('is:merged')) return { total_count: 57, incomplete_results: false, items: [] };
    if (q.includes('created:>=')) {
      const pr = q.includes('is:pr');
      const items = Object.entries(SAMPLE)
        .filter(([, v]) => v.pr === pr)
        .map(([n, v]) => ({
          number: Number(n),
          title: v.title,
          html_url: `https://github.com/${REPO}/${pr ? 'pull' : 'issues'}/${n}`,
          created_at: v.created,
          user: { login: v.author },
          author_association: 'FIRST_TIME_CONTRIBUTOR',
        }));
      return { total_count: items.length, incomplete_results: false, items };
    }
    if (q.includes('is:issue is:open') && query.get('per_page') === '30')
      return { total_count: 1, incomplete_results: false, items: [issue7] };
    return { total_count: q.includes('is:pr') ? 4 : 12, incomplete_results: false, items: [] };
  }
  if (path === '/user') return { login: 'tester' };
  return undefined;
}

function graphql(query: string): unknown {
  if (query.includes('query Insight'))
    return {
      data: {
        repository: {
          isPrivate: false,
          issue: {
            number: 7,
            title: issue7.title,
            url: issue7.html_url,
            state: 'OPEN',
            createdAt: issue7.created_at,
            body: issue7.body,
            author: { login: 'reporter' },
            assignees: { nodes: [] },
            labels: { nodes: [{ name: 'good first issue' }] },
            closedByPullRequestsReferences: {
              nodes: [
                {
                  number: 12,
                  title: 'Fix crash',
                  url: 'https://github.com/acme/widgets/pull/12',
                  state: 'OPEN',
                  isDraft: false,
                  merged: false,
                  author: { login: 'sam' },
                  repository: { nameWithOwner: REPO, isPrivate: false },
                },
              ],
            },
            timelineItems: { totalCount: 0, nodes: [] },
            comments: { totalCount: 0, nodes: [] },
          },
        },
      },
    };
  if (query.includes('query IssueList')) {
    const row = (number: number, extra: Record<string, unknown> = {}) => ({
      number,
      state: 'OPEN',
      assignees: { nodes: [] },
      closedByPullRequestsReferences: { nodes: [] },
      timelineItems: { totalCount: 0, nodes: [] },
      comments: { totalCount: 0, nodes: [] },
      ...extra,
    });
    return {
      data: {
        repository: {
          isPrivate: false,
          i7: row(7, {
            closedByPullRequestsReferences: {
              nodes: [
                {
                  number: 12,
                  title: 'Fix crash',
                  url: 'https://github.com/acme/widgets/pull/12',
                  state: 'OPEN',
                  isDraft: false,
                  merged: false,
                  author: { login: 'sam' },
                  repository: { nameWithOwner: REPO, isPrivate: false },
                },
              ],
            },
          }),
          i8: row(8),
          i9: row(9, {
            comments: {
              totalCount: 1,
              nodes: [
                {
                  author: { login: 'lena', __typename: 'User' },
                  authorAssociation: 'NONE',
                  createdAt: ago(2),
                  url: `https://github.com/${REPO}/issues/9#c1`,
                  body: 'Can I take this one?',
                },
              ],
            },
          }),
        },
      },
    };
  }
  return { errors: [{ message: 'Not mocked in e2e' }] };
}

export function startMockGitHub(port: number) {
  const dir = mkdtempSync(join(tmpdir(), 'contri-e2e-'));
  execFileSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-days',
      '1',
      '-subj',
      '/CN=github.com',
      '-keyout',
      join(dir, 'key.pem'),
      '-out',
      join(dir, 'cert.pem'),
    ],
    {
      stdio: 'ignore',
    },
  );
  const requests: string[] = [];
  /** Injected API failures: the next `times` requests whose path equals `path` get `status`. */
  const failures: Array<{ path: string; status: number; times: number }> = [];
  /** Client IDs that asked for a device code. */
  const deviceRequests: string[] = [];
  const server = createServer(
    { key: readFileSync(join(dir, 'key.pem')), cert: readFileSync(join(dir, 'cert.pem')) },
    (req: IncomingMessage, res: ServerResponse) => {
      const url = new URL(req.url ?? '/', `https://${req.headers.host}`);
      const host = (req.headers.host ?? '').split(':')[0];
      const send = (status: number, body: string, type = 'application/json', headers: Record<string, string> = {}) => {
        res.writeHead(status, {
          'content-type': type,
          'access-control-allow-origin': '*',
          'access-control-allow-headers': '*',
          ...headers,
        });
        res.end(body);
      };
      if (req.method === 'OPTIONS') return send(204, '');
      requests.push(`${host} ${req.method} ${url.pathname}${url.search}`);
      if (host === 'api.github.com') {
        const limits = {
          'x-ratelimit-remaining': '55',
          'x-ratelimit-limit': '60',
          'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 3600),
        };
        if (url.pathname === '/graphql') {
          let body = '';
          req.on('data', (c: Buffer) => (body += c));
          req.on('end', () =>
            send(200, JSON.stringify(graphql(JSON.parse(body).query)), 'application/json', {
              ...limits,
              'x-ratelimit-resource': 'graphql',
              'x-ratelimit-remaining': '4990',
            }),
          );
          return;
        }
        const failure = failures.find((f) => f.path === url.pathname && f.times > 0);
        if (failure) {
          failure.times--;
          return send(failure.status, JSON.stringify({ message: 'Injected failure' }), 'application/json', limits);
        }
        const value = rest(url.pathname, url.searchParams);
        if (value === undefined || value === null)
          return send(404, JSON.stringify({ message: 'Not Found' }), 'application/json', limits);
        return send(200, JSON.stringify(value), 'application/json', limits);
      }
      // GitHub's OAuth device flow (github.com/login/...): one code, approved on the first poll.
      if (req.method === 'POST' && url.pathname === '/login/device/code') {
        let body = '';
        req.on('data', (c: Buffer) => (body += c));
        req.on('end', () => {
          const clientId = new URLSearchParams(body).get('client_id');
          deviceRequests.push(clientId ?? '');
          send(
            200,
            JSON.stringify({
              device_code: 'mock-device-code',
              user_code: 'WDJB-MJHT',
              verification_uri: 'https://github.com/login/device',
              expires_in: 900,
              interval: 5,
            }),
          );
        });
        return;
      }
      if (req.method === 'POST' && url.pathname === '/login/oauth/access_token')
        return send(200, JSON.stringify({ access_token: 'gho_mock_device_token', token_type: 'bearer', scope: '' }));
      if (url.pathname === `/${REPO}`) return send(200, repoPage(), 'text/html');
      if (url.pathname === `/${REPO}/issues`) {
        const layout = url.searchParams.get('layout');
        return send(200, issuesListPage(layout === 'legacy' || layout === 'plain' ? layout : 'current'), 'text/html');
      }
      const issue = /^\/acme\/widgets\/issues\/(\d+)$/.exec(url.pathname);
      if (issue) return send(200, issuePage(Number(issue[1])), 'text/html');
      if (url.pathname === '/favicon.ico') return send(204, '');
      return send(200, blankPage(), 'text/html');
    },
  );
  server.listen(port);
  return {
    requests,
    deviceRequests,
    fail: (path: string, status: number, times = 1) => failures.push({ path, status, times }),
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
