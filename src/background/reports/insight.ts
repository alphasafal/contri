import { claimStatus, type ClaimStatus } from '../../core/claims';
import { discussionSummary, isTeamAssociation, linkState, type LinkState, type Reply } from '../../core/metrics';
import { teamCheck, type Roster } from '../../core/team';
import { repoPath } from '../../shared/repo';
import { splitRepo } from '../github';
import {
  COMMENT_FIELDS,
  gqlComment,
  preferGraphql,
  restComment,
  type Ctx,
  type GqlComment,
  type RestComment,
} from './context';
import { publicRepo } from './repo';

export type LinkedPR = {
  number: number;
  title: string;
  url: string;
  state: 'open' | 'closed' | 'merged';
  draft: boolean;
  author: string | null;
  repo: string;
  /** Linked through GitHub's Development panel or a closing keyword, not just mentioned. */
  closing: boolean;
};

export type InsightReport = {
  source: 'graphql' | 'rest';
  issue: {
    number: number;
    title: string;
    url: string;
    state: string;
    createdAt: string;
    author: string | null;
    assignees: string[];
    labels: string[];
    comments: number;
  };
  link: { state: LinkState; prs: LinkedPR[]; note: string };
  claim: ClaimStatus;
  discussion: ReturnType<typeof discussionSummary>;
  /** Plain-text thread for on-device summarization. Never leaves the browser. */
  thread: { text: string; truncated: boolean };
  warnings: string[];
  checkedAt: string;
};

const THREAD_LIMIT = 14_000;

/**
 * Comment text cannot forge a transcript header or close the `<thread>` tag the
 * on-device prompt wraps it in: a line starting with `---` could otherwise claim
 * to be from "@maintainer (project team)".
 */
export function neutralizeThreadBody(body: string) {
  return body.replace(/^[ \t]*---/gm, '—').replace(/<\/?thread\b/gi, '[thread');
}

/** Builds a compact transcript: the issue first, then the most recent comments that fit. */
export function threadText(
  issue: { title: string; body: string; author: string | null },
  replies: Reply[],
  isTeam: (l: string, a: string) => boolean,
) {
  const head = `Issue: ${issue.title}\nOpened by @${issue.author ?? 'ghost'}\n\n${neutralizeThreadBody((issue.body || '(no description)').slice(0, 5000))}\n`;
  const parts: string[] = [];
  let used = head.length;
  let truncated = issue.body.length > 5000;
  const ordered = [...replies].filter((r) => r.body).sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  for (const r of ordered) {
    const who = r.author
      ? `@${r.author.login}${isTeam(r.author.login, r.association) ? ' (project team)' : ''}`
      : '@ghost';
    const block = `\n--- ${who}, ${r.at.slice(0, 10)}\n${neutralizeThreadBody(r.body!.slice(0, 2500))}\n`;
    if (used + block.length > THREAD_LIMIT) {
      truncated = true;
      break;
    }
    parts.unshift(block);
    used += block.length;
  }
  return { text: head + parts.join(''), truncated };
}

function finish(
  source: InsightReport['source'],
  issue: InsightReport['issue'] & { body: string },
  prs: LinkedPR[],
  complete: boolean,
  replies: Reply[],
  repliesComplete: boolean,
  roster: Roster | undefined,
  warnings: string[],
  note: string,
): InsightReport {
  const isTeam = roster ? teamCheck(roster) : (_: string, association: string) => isTeamAssociation(association);
  const openPrAuthors = prs.filter((p) => p.state === 'open' && p.author).map((p) => p.author!);
  const { body, ...rest } = issue;
  return {
    source,
    issue: rest,
    link: { state: linkState(prs, complete), prs, note },
    claim: claimStatus({ comments: replies, isTeam, assignees: issue.assignees, openPrAuthors }),
    discussion: discussionSummary(replies, repliesComplete, isTeam),
    thread: threadText({ title: issue.title, body, author: issue.author }, replies, isTeam),
    warnings,
    checkedAt: new Date().toISOString(),
  };
}

type RestIssue = {
  number: number;
  title: string;
  html_url: string;
  state: string;
  created_at: string;
  body: string | null;
  user: { login: string } | null;
  assignees?: Array<{ login: string }>;
  labels: Array<{ name: string } | string>;
  comments: number;
  pull_request?: unknown;
};
type RestTimeline = {
  event: string;
  source?: {
    issue?: {
      number: number;
      title: string;
      html_url: string;
      state: string;
      draft?: boolean;
      user?: { login: string } | null;
      pull_request?: { merged_at?: string | null };
      repository?: { full_name: string; private?: boolean };
    };
  };
};

const COMMENT_PAGES = 3;

/**
 * REST lists comments oldest first. For long threads, read the newest pages: recent
 * claims and replies matter more than the opening discussion.
 */
async function newestComments(
  ctx: Ctx,
  path: string,
  total: number,
): Promise<{ values: RestComment[]; complete: boolean }> {
  const pages = Math.ceil(total / 100);
  if (pages <= COMMENT_PAGES) {
    const all = await ctx.client.restAll<RestComment>(path, COMMENT_PAGES);
    // A short page proves the end. Otherwise trust the issue's count only when it is not a
    // multiple of 100: a cached count can lag behind, and then a full last page hides newer ones.
    return { values: all.values, complete: all.complete || (all.values.length >= total && total % 100 !== 0) };
  }
  const values: RestComment[] = [];
  for (let page = pages - COMMENT_PAGES + 1; page <= pages; page++)
    values.push(...(await ctx.client.rest<RestComment[]>(`${path}?per_page=100&page=${page}`)));
  return { values, complete: false };
}

async function viaRest(ctx: Ctx, repo: string, number: number, roster?: Roster): Promise<InsightReport> {
  await publicRepo(ctx, repo);
  const base = repoPath(repo);
  const warnings: string[] = [];
  const issue = await ctx.client.rest<RestIssue>(`${base}/issues/${number}`);
  if (issue.pull_request) throw new Error('This number is a pull request, not an issue.');
  let complete: boolean;
  const prs = new Map<string, LinkedPR>();
  try {
    const timeline = await ctx.client.restAll<RestTimeline>(`${base}/issues/${number}/timeline`);
    complete = timeline.complete;
    for (const e of timeline.values) {
      const src = e.source?.issue;
      if (e.event !== 'cross-referenced' || !src?.pull_request || src.repository?.private) continue;
      prs.set(src.html_url, {
        number: src.number,
        title: src.title,
        url: src.html_url,
        state: src.pull_request.merged_at ? 'merged' : src.state === 'open' ? 'open' : 'closed',
        draft: Boolean(src.draft),
        author: src.user?.login ?? null,
        repo: src.repository?.full_name ?? repo,
        closing: false,
      });
    }
    if (timeline.values.some((e) => e.event === 'connected'))
      warnings.push('A pull request is linked in the Development panel. Sign in to see which one.');
  } catch (error) {
    if (ctx.signal?.aborted) throw error;
    complete = false;
    warnings.push('Timeline references could not be checked.');
  }
  let replies: Reply[] = [];
  let repliesComplete = false;
  try {
    const comments = await newestComments(ctx, `${base}/issues/${number}/comments`, issue.comments);
    replies = comments.values.map(restComment);
    repliesComplete = comments.complete;
  } catch (error) {
    if (ctx.signal?.aborted) throw error;
    warnings.push('Comments could not be loaded; claim detection is incomplete.');
  }
  return finish(
    'rest',
    {
      number: issue.number,
      title: issue.title,
      url: issue.html_url,
      state: issue.state,
      createdAt: issue.created_at,
      author: issue.user?.login ?? null,
      assignees: (issue.assignees ?? []).map((a) => a.login),
      labels: issue.labels.map((l) => (typeof l === 'string' ? l : l.name)),
      comments: issue.comments,
      body: issue.body ?? '',
    },
    [...prs.values()],
    complete,
    replies,
    repliesComplete,
    roster,
    warnings,
    complete
      ? 'Public timeline references checked. A reference may be unrelated, and unlinked work can exist.'
      : 'Timeline references could not be checked completely.',
  );
}

const PR_FIELDS = 'number title url state isDraft merged author { login } repository { nameWithOwner isPrivate }';
const INSIGHT_QUERY = `
query Insight($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    isPrivate
    issue(number: $number) {
      number title url state createdAt body
      author { login }
      assignees(first: 10) { nodes { login } }
      labels(first: 10) { nodes { name } }
      closedByPullRequestsReferences(first: 10, includeClosedPrs: true) { nodes { ${PR_FIELDS} } }
      timelineItems(itemTypes: [CROSS_REFERENCED_EVENT], last: 50) {
        totalCount
        nodes { ... on CrossReferencedEvent { source { ... on PullRequest { ${PR_FIELDS} } } } }
      }
      comments(last: 100) { totalCount nodes { ${COMMENT_FIELDS} body } }
    }
  }
}`;

type GqlPR = {
  number: number;
  title: string;
  url: string;
  state: 'OPEN' | 'CLOSED' | 'MERGED';
  isDraft: boolean;
  merged: boolean;
  author: { login: string } | null;
  repository: { nameWithOwner: string; isPrivate: boolean };
};
type InsightData = {
  repository: {
    isPrivate: boolean;
    issue: {
      number: number;
      title: string;
      url: string;
      state: string;
      createdAt: string;
      body: string;
      author: { login: string } | null;
      assignees: { nodes: Array<{ login: string }> };
      labels: { nodes: Array<{ name: string }> };
      closedByPullRequestsReferences: { nodes: GqlPR[] };
      timelineItems: { totalCount: number; nodes: Array<{ source?: GqlPR | Record<string, never> }> };
      comments: { totalCount: number; nodes: GqlComment[] };
    } | null;
  } | null;
};

const fromGql = (p: GqlPR, closing: boolean): LinkedPR => ({
  number: p.number,
  title: p.title,
  url: p.url,
  state: p.merged ? 'merged' : p.state === 'OPEN' ? 'open' : 'closed',
  draft: p.isDraft,
  author: p.author?.login ?? null,
  repo: p.repository.nameWithOwner,
  closing,
});

async function viaGraphql(ctx: Ctx, repo: string, number: number, roster?: Roster): Promise<InsightReport> {
  await publicRepo(ctx, repo);
  const { data, errors } = await ctx.client.graphql<InsightData>(INSIGHT_QUERY, { ...splitRepo(repo), number });
  const r = data.repository;
  if (!r || r.isPrivate) throw new Error('Only public repositories are supported.');
  const issue = r.issue;
  if (!issue) throw new Error('Issue not found. It may be a pull request or deleted.');
  const prs = new Map<string, LinkedPR>();
  for (const p of issue.closedByPullRequestsReferences.nodes)
    if (!p.repository.isPrivate) prs.set(p.url, fromGql(p, true));
  for (const n of issue.timelineItems.nodes) {
    const p = n.source as GqlPR | undefined;
    if (p?.url && !p.repository.isPrivate && !prs.has(p.url)) prs.set(p.url, fromGql(p, false));
  }
  const complete = issue.timelineItems.totalCount <= issue.timelineItems.nodes.length;
  return finish(
    'graphql',
    {
      number: issue.number,
      title: issue.title,
      url: issue.url,
      state: issue.state.toLowerCase(),
      createdAt: issue.createdAt,
      author: issue.author?.login ?? null,
      assignees: issue.assignees.nodes.map((a) => a.login),
      labels: issue.labels.nodes.map((l) => l.name),
      comments: issue.comments.totalCount,
      body: issue.body ?? '',
    },
    [...prs.values()],
    complete,
    issue.comments.nodes.map(gqlComment),
    issue.comments.totalCount <= issue.comments.nodes.length,
    roster,
    errors.map((e) => `Partial data from GitHub: ${e}`),
    complete
      ? 'Development links, closing keywords and timeline references checked. Unlinked work can still exist.'
      : 'Over 50 timeline references; only the latest 50 were checked.',
  );
}

export const insight = (ctx: Ctx, repo: string, number: number, roster?: Roster) =>
  preferGraphql(
    ctx,
    () => viaGraphql(ctx, repo, number, roster),
    () => viaRest(ctx, repo, number, roster),
  );
