import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';

/**
 * Runs the committed action bundle (action/dist/index.js) the way GitHub Actions does,
 * as a separate Node process with INPUT_* and GITHUB_* variables, against a small fake
 * GitHub API. Unit tests cover the decisions; this proves the bundle itself starts,
 * reads its inputs, talks HTTP and writes its outputs.
 *   npm run build:action && node scripts/smoke-action.mjs
 */
const REPO = 'acme/widgets';
const ago = (days) => new Date(Date.now() - days * 86_400_000).toISOString();
const writes = [];
let sawToken = true;

const server = createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    if (req.headers.authorization !== 'Bearer ghs_smoke') sawToken = false;
    const send = (value, status = 200) => {
      res.writeHead(status, { 'content-type': 'application/json', 'x-ratelimit-remaining': '900' });
      res.end(JSON.stringify(value));
    };
    const url = new URL(req.url, 'http://localhost');
    if (req.method === 'POST' && url.pathname === '/graphql') {
      const { query } = JSON.parse(body);
      if (query.includes('query Closing'))
        return send({
          data: {
            repository: {
              pullRequest: { closingIssuesReferences: { nodes: [{ number: 7, repository: { nameWithOwner: REPO } }] } },
            },
          },
        });
      if (query.includes('query Insight'))
        return send({
          data: {
            repository: {
              isPrivate: false,
              issue: {
                number: 7,
                title: 'Fix the widget crash',
                url: `https://github.com/${REPO}/issues/7`,
                state: 'OPEN',
                createdAt: ago(90),
                body: 'It crashes.',
                author: { login: 'reporter' },
                assignees: { nodes: [] },
                labels: { nodes: [] },
                closedByPullRequestsReferences: { nodes: [] },
                timelineItems: { totalCount: 0, nodes: [] },
                comments: {
                  totalCount: 1,
                  nodes: [
                    {
                      author: { login: 'lena', __typename: 'User' },
                      authorAssociation: 'NONE',
                      createdAt: ago(2),
                      url: `https://github.com/${REPO}/issues/7#issuecomment-1`,
                      body: 'Can I take this one?',
                    },
                  ],
                },
              },
            },
          },
        });
      return send({ errors: [{ message: 'not mocked' }] });
    }
    if (req.method !== 'GET') {
      writes.push({ method: req.method, path: url.pathname, body: JSON.parse(body) });
      return send({ id: 1 }, 201);
    }
    if (url.pathname === `/repos/${REPO}`)
      return send({
        full_name: REPO,
        name: 'widgets',
        owner: { login: 'acme', type: 'Organization' },
        html_url: `https://github.com/${REPO}`,
        private: false,
        has_issues: true,
        default_branch: 'main',
      });
    if (url.pathname === `/repos/${REPO}/issues/50/comments`) return send([]);
    send({ message: 'Not Found' }, 404);
  });
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const dir = mkdtempSync(join(tmpdir(), 'contri-action-smoke-'));
const event = join(dir, 'event.json');
const output = join(dir, 'output.txt');
const summary = join(dir, 'summary.md');
writeFileSync(
  event,
  JSON.stringify({
    action: 'opened',
    pull_request: { number: 50, body: 'Fixes #7', author_association: 'NONE', user: { login: 'newbie', type: 'User' } },
  }),
);
writeFileSync(output, '');
writeFileSync(summary, '');

const child = spawn(process.execPath, ['action/dist/index.js'], {
  env: {
    PATH: process.env.PATH,
    GITHUB_REPOSITORY: REPO,
    GITHUB_EVENT_NAME: 'pull_request_target',
    GITHUB_EVENT_PATH: event,
    GITHUB_OUTPUT: output,
    GITHUB_STEP_SUMMARY: summary,
    GITHUB_API_URL: `http://127.0.0.1:${server.address().port}`,
    'INPUT_GITHUB-TOKEN': 'ghs_smoke',
    'INPUT_SKIP-TEAM': 'true',
    INPUT_LABEL: '',
    'INPUT_STALE-DAYS': '30',
    'INPUT_MAX-NUDGES': '5',
    'INPUT_DRY-RUN': 'false',
    'INPUT_FAIL-ON-ERROR': 'true',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let log = '';
child.stdout.on('data', (c) => (log += c));
child.stderr.on('data', (c) => (log += c));
const code = await new Promise((resolve) => child.on('close', resolve));
server.close();

assert.equal(code, 0, `the action exited with ${code}:\n${log}`);
assert.ok(sawToken, 'every request carries the token');
assert.deepEqual(
  writes.map((w) => `${w.method} ${w.path}`),
  [`POST /repos/${REPO}/issues/50/comments`],
  `unexpected writes:\n${log}`,
);
assert.match(writes[0].body.body, /<!-- contri:duplicate-work -->/);
assert.match(writes[0].body.body, /@lena \[offered to work on #7\]/);
assert.equal(readFileSync(output, 'utf8'), 'findings=1\nnudged=0\n');
assert.match(readFileSync(summary, 'utf8'), /may already be taken/);
console.log('Action bundle smoke test passed: one comment posted, outputs and summary written.');
