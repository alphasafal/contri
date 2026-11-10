import { appendFileSync, readFileSync } from 'node:fs';
import { API, clearMemory, GitHubError, setTransport } from '../../src/background/github';
import { createCtx } from '../../src/background/reports/context';
import { insight } from '../../src/background/reports/insight';
import { searchIssues } from '../../src/background/reports/issues';
import { isTeamAssociation } from '../../src/core/metrics';
import { parseRepo } from '../../src/shared/repo';
import {
  closingNumbers,
  DUPLICATE_MARKER,
  duplicateComment,
  duplicateWork,
  nudgeComment,
  nudgeMarker,
  quietClaim,
  type Finding,
} from './findings';

/**
 * The CONTRI action. On a pull request it checks whether the issue it closes is already
 * taken by someone else and says so once, in one comment. On a schedule it asks people
 * whose claim went quiet whether they are still on it. It reads with the same reports as
 * the extension and only ever writes comments (and one optional label).
 */

export type Env = Record<string, string | undefined>;
export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;
export type Result = {
  mode: 'pull-request' | 'quiet-claims' | 'skipped';
  findings: Finding[];
  nudged: number[];
  notes: string[];
};

/** Same rule as @actions/core: `stale-days` arrives as INPUT_STALE-DAYS. */
const input = (env: Env, name: string, fallback = '') =>
  (env[`INPUT_${name.replace(/ /g, '_').toUpperCase()}`] ?? '').trim() || fallback;
const flag = (env: Env, name: string, fallback: boolean) => {
  const value = input(env, name).toLowerCase();
  return value ? value === 'true' : fallback;
};
const count = (env: Env, name: string, fallback: number, max: number) => {
  const raw = input(env, name);
  const value = Number(raw);
  return raw && Number.isInteger(value) && value >= 0 ? Math.min(value, max) : fallback;
};

type PullRequestEvent = {
  action?: string;
  pull_request?: {
    number: number;
    body: string | null;
    draft?: boolean;
    state?: string;
    author_association?: string;
    user?: { login: string; type?: string } | null;
  };
};

const MAX_ISSUES_PER_PR = 5;
const MAX_ISSUES_PER_RUN = 30;

export async function run(env: Env, base: Fetcher = (url, init) => fetch(url, init)): Promise<Result> {
  const notes: string[] = [];
  const repo = parseRepo(env.GITHUB_REPOSITORY ?? '');
  if (!repo) throw new Error('GITHUB_REPOSITORY is not set to owner/name.');
  const token = input(env, 'github-token') || env.GITHUB_TOKEN || '';
  if (!token) throw new Error('No token. Pass github-token: ${{ github.token }} (it is the default in action.yml).');
  const dryRun = flag(env, 'dry-run', false);
  // github.com only. GITHUB_API_URL lets tests point at a fake; the token goes nowhere else.
  const apiBase = (env.GITHUB_API_URL || API).replace(/\/+$/, '');
  const send: Fetcher = (url, init = {}) => {
    const target = url.startsWith(API) ? apiBase + url.slice(API.length) : url;
    if (!target.startsWith(`${apiBase}/`)) throw new Error('CONTRI only talks to the GitHub API.');
    const headers = new Headers(init.headers);
    headers.set('User-Agent', 'contri-action');
    headers.set('Authorization', `Bearer ${token}`);
    return base(target, { ...init, headers });
  };
  clearMemory();
  setTransport(send);

  const write = async (method: 'POST' | 'PATCH', path: string, body: unknown) => {
    const response = await send(`${API}${path}`, {
      method,
      headers: { Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const detail = ((await response.json().catch(() => ({}))) as { message?: string }).message ?? '';
      throw new Error(
        `GitHub answered ${response.status} for ${method} ${path}${detail ? `: ${detail}` : ''}. The workflow needs "issues: write" and "pull-requests: write" permissions.`,
      );
    }
    return response;
  };
  type Comment = { id: number; body?: string | null; created_at?: string };
  const comments = async (number: number) => {
    const ctx = createCtx(true);
    // Newest last; three pages covers 300 comments, far more than a marker needs.
    return (await ctx.client.restAll<Comment>(`/repos/${repo}/issues/${number}/comments`, 3)).values;
  };

  const event = env.GITHUB_EVENT_NAME ?? '';
  const payload = (
    env.GITHUB_EVENT_PATH ? JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8')) : {}
  ) as PullRequestEvent;

  /* ---------- a pull request: is its issue already taken? ---------- */
  if (event === 'pull_request' || event === 'pull_request_target') {
    const pr = payload.pull_request;
    if (!pr?.user) return { mode: 'skipped', findings: [], nudged: [], notes: ['No pull request in the event.'] };
    const author = pr.user.login;
    if (pr.user.type === 'Bot' || /\[bot\]$/i.test(author))
      return { mode: 'skipped', findings: [], nudged: [], notes: [`@${author} is a bot.`] };
    if (flag(env, 'skip-team', true) && isTeamAssociation(pr.author_association))
      return { mode: 'skipped', findings: [], nudged: [], notes: [`@${author} is on the project team.`] };

    const numbers = new Set(closingNumbers(pr.body ?? '', repo));
    // GitHub's own list also covers issues linked from the Development panel.
    try {
      const [owner, name] = repo.split('/');
      const { data } = await createCtx(true).client.graphql<{
        repository: {
          pullRequest: {
            closingIssuesReferences: { nodes: Array<{ number: number; repository: { nameWithOwner: string } }> };
          } | null;
        } | null;
      }>(
        `query Closing($owner: String!, $name: String!, $number: Int!) { repository(owner: $owner, name: $name) { pullRequest(number: $number) { closingIssuesReferences(first: 10) { nodes { number repository { nameWithOwner } } } } } }`,
        { owner, name, number: pr.number },
      );
      for (const node of data.repository?.pullRequest?.closingIssuesReferences.nodes ?? [])
        if (node.repository.nameWithOwner.toLowerCase() === repo.toLowerCase()) numbers.add(node.number);
    } catch (error) {
      notes.push(
        `Linked issues could not be read from GitHub (${(error as Error).message}); used the description only.`,
      );
    }
    if (!numbers.size)
      return { mode: 'pull-request', findings: [], nudged: [], notes: [...notes, 'The pull request closes no issue.'] };

    const findings: Finding[] = [];
    for (const number of [...numbers].slice(0, MAX_ISSUES_PER_PR)) {
      try {
        const report = await insight(createCtx(true), repo, number);
        findings.push(...duplicateWork(report, { number: pr.number, author }, repo));
      } catch (error) {
        // A number that is a pull request, or a deleted issue, is not this action's problem.
        if (!(error instanceof GitHubError) || error.status !== 404)
          notes.push(`#${number}: ${(error as Error).message}`);
      }
    }
    if (!findings.length)
      return { mode: 'pull-request', findings, nudged: [], notes: [...notes, 'Nobody else is on it.'] };

    const body = duplicateComment(author, findings);
    if (dryRun) notes.push(`Dry run. Would comment on #${pr.number}:\n${body}`);
    else {
      const existing = (await comments(pr.number)).find((c) => c.body?.includes(DUPLICATE_MARKER));
      if (existing && existing.body === body) notes.push('The comment is already there.');
      else if (existing) await write('PATCH', `/repos/${repo}/issues/comments/${existing.id}`, { body });
      else await write('POST', `/repos/${repo}/issues/${pr.number}/comments`, { body });
      const label = input(env, 'label');
      if (label) await write('POST', `/repos/${repo}/issues/${pr.number}/labels`, { labels: [label] });
    }
    return { mode: 'pull-request', findings, nudged: [], notes };
  }

  /* ---------- on a schedule: claims that went quiet ---------- */
  if (event === 'schedule' || event === 'workflow_dispatch') {
    const staleDays = count(env, 'stale-days', 30, 3650);
    const limit = count(env, 'max-nudges', 5, 20);
    const nudged: number[] = [];
    if (!limit) return { mode: 'quiet-claims', findings: [], nudged, notes: ['max-nudges is 0.'] };
    // "Beginner" issues are where claims pile up: good first issue and help wanted, unassigned.
    const list = await searchIssues(createCtx(true), {
      repo,
      label: 'beginner',
      query: '',
      unassigned: true,
      sort: 'updated',
      page: 1,
    });
    for (const item of list.items.slice(0, MAX_ISSUES_PER_RUN)) {
      if (nudged.length >= limit) break;
      if (!item.comments) continue;
      let nudge;
      try {
        nudge = quietClaim(await insight(createCtx(true), repo, item.number), staleDays);
      } catch (error) {
        notes.push(`#${item.number}: ${(error as Error).message}`);
        continue;
      }
      if (!nudge) continue;
      // One nudge per person per issue, ever.
      const marker = nudgeMarker(nudge.login);
      if ((await comments(item.number)).some((c) => c.body?.includes(marker))) continue;
      const body = nudgeComment(nudge);
      if (dryRun) notes.push(`Dry run. Would comment on #${item.number}:\n${body}`);
      else await write('POST', `/repos/${repo}/issues/${item.number}/comments`, { body });
      nudged.push(item.number);
    }
    if (!nudged.length) notes.push('No claim has gone quiet.');
    return { mode: 'quiet-claims', findings: [], nudged, notes };
  }

  return { mode: 'skipped', findings: [], nudged: [], notes: [`Nothing to do for the "${event}" event.`] };
}

/** Writes the result where GitHub Actions shows it: the log, the step summary and the outputs. */
export function report(result: Result, env: Env) {
  for (const note of result.notes) console.log(note);
  const lines =
    result.mode === 'pull-request'
      ? result.findings.length
        ? ['**CONTRI: this issue may already be taken**', ...result.findings.map((f) => `- ${f.text}`)]
        : ['**CONTRI:** nobody else appears to be working on the linked issue.']
      : result.mode === 'quiet-claims'
        ? [
            `**CONTRI:** ${result.nudged.length ? `asked about quiet claims on ${result.nudged.map((n) => `#${n}`).join(', ')}.` : 'no claim has gone quiet.'}`,
          ]
        : [`**CONTRI:** skipped. ${result.notes.join(' ')}`];
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `${lines.join('\n')}\n`);
  if (env.GITHUB_OUTPUT)
    appendFileSync(env.GITHUB_OUTPUT, `findings=${result.findings.length}\nnudged=${result.nudged.length}\n`);
}
