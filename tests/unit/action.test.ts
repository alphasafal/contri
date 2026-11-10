import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { clearMemory } from '../../src/background/github';
import type { InsightReport } from '../../src/background/reports/insight';
import {
  closingNumbers,
  DUPLICATE_MARKER,
  duplicateComment,
  duplicateWork,
  nudgeMarker,
  quietClaim,
} from '../../action/src/findings';
import { report, run } from '../../action/src/run';
import { fakeGitHub, isoAgo, json, repoJson } from './helpers';

const REPO = 'acme/widgets';

const said = (login: string, body: string, days: number, authorAssociation = 'NONE') => ({
  author: { login, __typename: 'User' },
  authorAssociation,
  createdAt: isoAgo(days),
  url: `https://github.com/${REPO}/issues/7#${login}`,
  body,
});
const openPr = (number: number, login: string) => ({
  number,
  title: 'Fix',
  url: `https://github.com/${REPO}/pull/${number}`,
  state: 'OPEN',
  isDraft: false,
  merged: false,
  author: { login },
  repository: { nameWithOwner: REPO, isPrivate: false },
});
const issueNode = (extra: Record<string, unknown> = {}) => ({
  number: 7,
  title: 'Fix the widget crash',
  url: `https://github.com/${REPO}/issues/7`,
  state: 'OPEN',
  createdAt: isoAgo(90),
  body: 'It crashes.',
  author: { login: 'reporter' },
  assignees: { nodes: [] },
  labels: { nodes: [] },
  closedByPullRequestsReferences: { nodes: [] },
  timelineItems: { totalCount: 0, nodes: [] },
  comments: { totalCount: 0, nodes: [] },
  ...extra,
});

/** A fake GitHub for one run: answers the reads and records every write. */
function github(options: { issue?: Record<string, unknown>; existing?: Array<{ id: number; body: string }> }) {
  const writes: Array<{ method: string; path: string; body: Record<string, unknown> }> = [];
  const { fetcher, calls } = fakeGitHub([
    (url, init) => {
      const method = init?.method ?? 'GET';
      if (method === 'POST' && url.pathname === '/graphql') {
        const { query } = JSON.parse(String(init?.body)) as { query: string };
        if (query.includes('query Closing'))
          return json({
            data: {
              repository: {
                pullRequest: {
                  closingIssuesReferences: { nodes: [{ number: 7, repository: { nameWithOwner: REPO } }] },
                },
              },
            },
          });
        if (query.includes('query Insight'))
          return json({ data: { repository: { isPrivate: false, issue: issueNode(options.issue) } } });
        if (query.includes('query Links')) return json({ data: { repository: {} } });
        return json({ errors: [{ message: 'not mocked' }] });
      }
      if (method !== 'GET') {
        writes.push({ method, path: url.pathname, body: JSON.parse(String(init?.body)) as Record<string, unknown> });
        return json({ id: 1 }, 201);
      }
      if (url.pathname === `/repos/${REPO}`) return json(repoJson());
      if (/^\/repos\/acme\/widgets\/issues\/\d+\/comments$/.test(url.pathname)) return json(options.existing ?? []);
      if (url.pathname === '/search/issues')
        return json({
          total_count: 1,
          incomplete_results: false,
          items: [
            {
              number: 7,
              title: 'Fix the widget crash',
              html_url: `https://github.com/${REPO}/issues/7`,
              created_at: isoAgo(90),
              updated_at: isoAgo(2),
              labels: [{ name: 'good first issue' }],
              assignees: [],
              comments: 1,
              user: { login: 'reporter' },
            },
          ],
        });
      return undefined;
    },
  ]);
  return { fetcher, calls, writes };
}

function env(event: string, payload: unknown, inputs: Record<string, string> = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'contri-action-'));
  writeFileSync(join(dir, 'event.json'), JSON.stringify(payload));
  writeFileSync(join(dir, 'summary.md'), '');
  writeFileSync(join(dir, 'output.txt'), '');
  return {
    GITHUB_REPOSITORY: REPO,
    GITHUB_EVENT_NAME: event,
    GITHUB_EVENT_PATH: join(dir, 'event.json'),
    GITHUB_STEP_SUMMARY: join(dir, 'summary.md'),
    GITHUB_OUTPUT: join(dir, 'output.txt'),
    'INPUT_GITHUB-TOKEN': 'ghs_test',
    ...Object.fromEntries(Object.entries(inputs).map(([k, v]) => [`INPUT_${k.toUpperCase()}`, v])),
  };
}

const pullRequest = (login: string, body: string, association = 'NONE') => ({
  action: 'opened',
  pull_request: { number: 50, body, author_association: association, user: { login, type: 'User' } },
});

beforeEach(() => clearMemory());

describe('action: reading a pull request', () => {
  it('finds the issues a description closes, in this repository only', () => {
    expect(closingNumbers('Fixes #12 and closes: #7.\nResolved #7 again, see #99', REPO)).toEqual([12, 7]);
    expect(closingNumbers('fixes acme/widgets#3, fixes other/repo#4', REPO)).toEqual([3]);
    expect(closingNumbers('prefixes #5; no keyword #6', REPO)).toEqual([]);
  });
});

describe('action: is the issue already taken?', () => {
  const base = (extra: Partial<InsightReport> = {}): InsightReport =>
    ({
      issue: { number: 7, state: 'open', assignees: [] },
      link: { state: 'clear', prs: [], note: '' },
      claim: { state: 'none', assignees: [], note: '' },
      ...extra,
    }) as unknown as InsightReport;
  const pr = { number: 50, author: 'newbie' };

  it('puts another open pull request first, and never counts the author against themselves', () => {
    const other = { number: 40, state: 'open', author: 'sam', repo: REPO };
    const report = base({
      link: { state: 'open', prs: [other], note: '' },
      issue: { number: 7, state: 'open', assignees: ['kim'] },
    } as unknown as Partial<InsightReport>);
    expect(duplicateWork(report, pr, REPO).map((f) => f.kind)).toEqual(['open-pr']);
    expect(duplicateWork(report, pr, REPO)[0].text).toBe('#7 already has an open pull request: #40 by @sam.');
    // The same PR, the author's own second PR, and a fork's PR are not someone else's work here.
    const own = base({
      link: {
        state: 'open',
        prs: [
          { number: 50, state: 'open', author: 'newbie', repo: REPO },
          { number: 51, state: 'open', author: 'Newbie', repo: REPO },
          { number: 3, state: 'open', author: 'sam', repo: 'fork/widgets' },
        ],
        note: '',
      },
    } as unknown as Partial<InsightReport>);
    expect(duplicateWork(own, pr, REPO)).toEqual([]);
  });

  it('reports an assignee, a fresh claim or a maintainer on it, but not a quiet claim or a closed issue', () => {
    const claim = { login: 'lena', at: isoAgo(2), url: 'https://github.com/acme/widgets/issues/7#c', text: '' };
    expect(
      duplicateWork(base({ issue: { number: 7, state: 'open', assignees: ['kim'] } } as never), pr, REPO)[0].kind,
    ).toBe('assigned');
    expect(
      duplicateWork(base({ issue: { number: 7, state: 'open', assignees: ['NEWBIE'] } } as never), pr, REPO),
    ).toEqual([]);
    const claimed = base({ claim: { state: 'claimed', claim, ageDays: 2, assignees: [], note: '' } } as never);
    expect(duplicateWork(claimed, pr, REPO)[0]).toMatchObject({ kind: 'claimed' });
    expect(duplicateWork(claimed, pr, REPO)[0].text).toContain('@lena [offered to work on #7]');
    expect(duplicateWork(claimed, { number: 50, author: 'Lena' }, REPO)).toEqual([]);
    const quiet = base({ claim: { state: 'stale', claim, ageDays: 40, assignees: [], note: '' } } as never);
    expect(duplicateWork(quiet, pr, REPO)).toEqual([]);
    const team = base({
      claim: { state: 'none', assignees: [], note: '', team: { claim, ageDays: 3, fresh: true } },
    } as never);
    expect(duplicateWork(team, pr, REPO)[0].kind).toBe('team');
    const closed = base({ issue: { number: 7, state: 'closed', assignees: ['kim'] } } as never);
    expect(duplicateWork(closed, pr, REPO)).toEqual([]);
  });

  it('asks about a claim only once it is quiet for long enough', () => {
    const claim = { login: 'sam', at: isoAgo(45), url: 'u', text: '' };
    const stale = base({ claim: { state: 'stale', claim, ageDays: 45, assignees: [], note: '' } } as never);
    expect(quietClaim(stale, 30)).toMatchObject({ issue: 7, login: 'sam', ageDays: 45 });
    expect(quietClaim(stale, 60)).toBeNull();
    // Never sooner than the extension itself calls a claim quiet, whatever the input says.
    const recent = base({ claim: { state: 'stale', claim, ageDays: 21, assignees: [], note: '' } } as never);
    expect(quietClaim(recent, 1)).toBeNull();
    expect(
      quietClaim(base({ claim: { state: 'claimed', claim, ageDays: 45, assignees: [], note: '' } } as never), 30),
    ).toBeNull();
  });
});

describe('action: a pull request run', () => {
  it('comments once when someone else claimed the issue, and labels when asked', async () => {
    const gh = github({ issue: { comments: { totalCount: 1, nodes: [said('lena', 'Can I take this?', 2)] } } });
    const e = env('pull_request_target', pullRequest('newbie', 'Fixes #7'), { label: 'possible duplicate' });
    const result = await run(e, gh.fetcher);
    expect(result.mode).toBe('pull-request');
    expect(result.findings.map((f) => f.kind)).toEqual(['claimed']);
    expect(gh.writes.map((w) => `${w.method} ${w.path}`)).toEqual([
      'POST /repos/acme/widgets/issues/50/comments',
      'POST /repos/acme/widgets/issues/50/labels',
    ]);
    const body = String(gh.writes[0].body.body);
    expect(body).toContain(DUPLICATE_MARKER);
    expect(body).toContain('@newbie');
    expect(body).toContain('@lena [offered to work on #7]');
    expect(gh.writes[1].body).toEqual({ labels: ['possible duplicate'] });
    report(result, e);
    expect(readFileSync(e.GITHUB_OUTPUT, 'utf8')).toBe('findings=1\nnudged=0\n');
    expect(readFileSync(e.GITHUB_STEP_SUMMARY, 'utf8')).toContain('may already be taken');
  });

  it('sends the token to the GitHub API only, on every request', async () => {
    const seen: Array<{ url: string; auth: string | null }> = [];
    const gh = github({ issue: { assignees: { nodes: [{ login: 'kim' }] } } });
    await run(env('pull_request', pullRequest('newbie', 'Fixes #7')), (url, init) => {
      seen.push({ url, auth: new Headers(init?.headers).get('authorization') });
      return gh.fetcher(url, init);
    });
    expect(seen.length).toBeGreaterThan(3);
    expect(seen.every((s) => s.url.startsWith('https://api.github.com/') && s.auth === 'Bearer ghs_test')).toBe(true);
  });

  it('updates its earlier comment instead of adding another, and stays quiet when nothing changed', async () => {
    const issue = { closedByPullRequestsReferences: { nodes: [openPr(40, 'sam'), openPr(50, 'newbie')] } };
    const first = github({ issue, existing: [{ id: 9, body: `${DUPLICATE_MARKER}\nold text` }] });
    await run(env('pull_request_target', pullRequest('newbie', 'Fixes #7')), first.fetcher);
    expect(first.writes.map((w) => `${w.method} ${w.path}`)).toEqual(['PATCH /repos/acme/widgets/issues/comments/9']);
    expect(String(first.writes[0].body.body)).toContain('#7 already has an open pull request: #40 by @sam.');

    clearMemory();
    const current = duplicateComment('newbie', [
      { issue: 7, kind: 'open-pr', text: '#7 already has an open pull request: #40 by @sam.' },
    ]);
    const second = github({ issue, existing: [{ id: 9, body: current }] });
    const result = await run(env('pull_request_target', pullRequest('newbie', 'Fixes #7')), second.fetcher);
    expect(second.writes).toEqual([]);
    expect(result.notes).toContain('The comment is already there.');
  });

  it('says nothing when the author is the claimant, on the team, a bot, or the issue is free', async () => {
    const claimedByAuthor = github({
      issue: { comments: { totalCount: 1, nodes: [said('newbie', "I'd like to work on this", 2)] } },
    });
    const mine = await run(env('pull_request_target', pullRequest('newbie', 'Fixes #7')), claimedByAuthor.fetcher);
    expect(mine.findings).toEqual([]);
    expect(claimedByAuthor.writes).toEqual([]);

    clearMemory();
    const taken = { issue: { assignees: { nodes: [{ login: 'kim' }] } } };
    const team = github(taken);
    expect((await run(env('pull_request_target', pullRequest('maint', 'Fixes #7', 'MEMBER')), team.fetcher)).mode).toBe(
      'skipped',
    );
    expect(team.calls).toEqual([]);
    const bot = github(taken);
    expect((await run(env('pull_request_target', pullRequest('renovate[bot]', 'Fixes #7')), bot.fetcher)).mode).toBe(
      'skipped',
    );

    clearMemory();
    const free = github({});
    const result = await run(env('pull_request_target', pullRequest('newbie', 'Fixes #7')), free.fetcher);
    expect(result.findings).toEqual([]);
    expect(free.writes).toEqual([]);
  });

  it('a dry run decides the same and writes nothing', async () => {
    const gh = github({ issue: { assignees: { nodes: [{ login: 'kim' }] } } });
    const result = await run(
      env('pull_request_target', pullRequest('newbie', 'Fixes #7'), { 'dry-run': 'true' }),
      gh.fetcher,
    );
    expect(result.findings.map((f) => f.kind)).toEqual(['assigned']);
    expect(gh.writes).toEqual([]);
    expect(result.notes.join('\n')).toContain('Dry run. Would comment on #50');
  });
});

describe('action: quiet claims on a schedule', () => {
  const quiet = { comments: { totalCount: 1, nodes: [said('sam', "I'd like to work on this", 45)] } };

  it('asks the claimant once, and never again on the same issue', async () => {
    const gh = github({ issue: quiet });
    const result = await run(env('schedule', {}), gh.fetcher);
    expect(result).toMatchObject({ mode: 'quiet-claims', nudged: [7] });
    expect(gh.writes.map((w) => `${w.method} ${w.path}`)).toEqual(['POST /repos/acme/widgets/issues/7/comments']);
    const body = String(gh.writes[0].body.body);
    expect(body).toContain(nudgeMarker('sam'));
    expect(body).toMatch(/^.*\n@sam, are you still working on this\? You \[offered\]\(.+\) 45 days ago/);

    clearMemory();
    const again = github({ issue: quiet, existing: [{ id: 3, body }] });
    const second = await run(env('schedule', {}), again.fetcher);
    expect(second.nudged).toEqual([]);
    expect(again.writes).toEqual([]);
  });

  it('respects stale-days, max-nudges and dry-run', async () => {
    const later = github({ issue: quiet });
    expect((await run(env('schedule', {}, { 'stale-days': '60' }), later.fetcher)).nudged).toEqual([]);
    clearMemory();
    const off = github({ issue: quiet });
    expect((await run(env('workflow_dispatch', {}, { 'max-nudges': '0' }), off.fetcher)).nudged).toEqual([]);
    expect(off.calls).toEqual([]);
    clearMemory();
    const dry = github({ issue: quiet });
    const result = await run(env('workflow_dispatch', {}, { 'dry-run': 'true' }), dry.fetcher);
    expect(result.nudged).toEqual([7]);
    expect(dry.writes).toEqual([]);
  });

  it('leaves an active claim alone', async () => {
    const gh = github({ issue: { comments: { totalCount: 1, nodes: [said('sam', "I'd like to work on this", 5)] } } });
    expect((await run(env('schedule', {}), gh.fetcher)).nudged).toEqual([]);
    expect(gh.writes).toEqual([]);
  });
});

describe('action: other events and bad setup', () => {
  it('does nothing for events it does not handle, and explains a missing token', async () => {
    const gh = github({});
    expect((await run(env('push', {}), gh.fetcher)).mode).toBe('skipped');
    const e = env('schedule', {});
    delete (e as Record<string, string | undefined>)['INPUT_GITHUB-TOKEN'];
    await expect(run(e, gh.fetcher)).rejects.toThrow(/No token/);
  });
});
