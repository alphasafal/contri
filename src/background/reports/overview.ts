import {
  activity,
  actor,
  isHuman,
  since,
  timing,
  type Event,
  type Merge,
  type Timing,
  type Week,
} from '../../core/metrics';
import { repoPath } from '../../shared/repo';
import { splitRepo } from '../github';
import { optional, preferGraphql, AUTHOR, type Ctx } from './context';
import { publicRepo } from './repo';

/** Common automation accounts excluded from the exact merged-PR count. */
export const COMMON_BOTS = ['app/dependabot', 'app/renovate', 'app/github-actions', 'app/pre-commit-ci'];

export type OverviewReport = {
  source: 'graphql' | 'rest';
  /** Exact number of PRs merged in 90 days (common bots excluded), from GitHub search. */
  mergedExact: number | null;
  /** Human merges among the most recently updated merged PRs (up to 100). */
  sample: { merged: number; authors: number; weeks: Week[]; from: string; limited: boolean; available: boolean };
  commits: { count: number | null; limited: boolean };
  openIssues: number | null;
  openPRs: number | null;
  release: { name: string; url: string; publishedAt: string } | null;
  latest: Event | null;
  mergeTiming: Timing;
  warnings: string[];
  checkedAt: string;
};

const mergedQuery = (repo: string, from: string) =>
  `repo:${repo} is:pr is:merged merged:>=${from.slice(0, 10)} ${COMMON_BOTS.map((b) => `-author:${b}`).join(' ')}`;

function summarize(
  ctx: Ctx,
  source: OverviewReport['source'],
  merges: Merge[],
  commitEvents: Event[],
  rest: Omit<OverviewReport, 'source' | 'sample' | 'latest' | 'mergeTiming' | 'checkedAt'>,
  sampleAvailable: boolean,
  /** The page GitHub returned was full, so older merges in the window may exist. */
  capped: boolean,
): OverviewReport {
  const from = since(ctx.now.getTime());
  const metrics = activity(merges, ctx.now);
  const oldest = merges.reduce((min, m) => Math.min(min, Date.parse(m.mergedAt)), Infinity);
  const limited = capped && oldest >= Date.parse(from);
  const events: Event[] = [
    ...merges
      .filter((m) => isHuman(m.author))
      .map((m) => ({ at: m.mergedAt, url: m.url, kind: 'Human PR merged', login: m.author!.login })),
    ...commitEvents,
  ];
  const latest =
    events.filter((e) => Date.parse(e.at) <= Date.now()).sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0] ?? null;
  const mergeHours = merges
    .filter((m) => isHuman(m.author) && Date.parse(m.mergedAt) >= Date.parse(from))
    .map((m) => (Date.parse(m.mergedAt) - Date.parse(m.createdAt)) / 3_600_000)
    .filter((h) => h >= 0);
  if (limited)
    rest.warnings.push('The weekly chart and author count cover the 100 most recently updated merged PRs only.');
  return {
    ...rest,
    source,
    sample: { ...metrics, limited, available: sampleAvailable },
    latest,
    mergeTiming: timing(mergeHours),
    checkedAt: new Date().toISOString(),
  };
}

async function viaRest(ctx: Ctx, repo: string): Promise<OverviewReport> {
  await publicRepo(ctx, repo);
  const base = repoPath(repo);
  const from = since(ctx.now.getTime());
  const warnings: string[] = [];
  type RestPull = {
    number: number;
    html_url: string;
    created_at: string;
    merged_at: string | null;
    user: { login: string; type?: string } | null;
  };
  type RestCommit = {
    author: { login: string; type?: string } | null;
    html_url: string;
    commit: { author: { date: string } };
  };
  type Count = { total_count: number; incomplete_results: boolean };
  const pulls = await optional(ctx, warnings, 'Pull request activity', () =>
    ctx.client.rest<RestPull[]>(`${base}/pulls?state=closed&sort=updated&direction=desc&per_page=100`),
  );
  const commits = await optional(ctx, warnings, 'Commit activity', () =>
    ctx.client.rest<RestCommit[]>(`${base}/commits?since=${encodeURIComponent(from)}&per_page=100`),
  );
  const search = (label: string, q: string) =>
    optional(ctx, warnings, label, () =>
      ctx.client.rest<Count>(`/search/issues?q=${encodeURIComponent(q)}&per_page=1`),
    );
  const [openIssues, openPRs, merged] = [
    await search('Open issue count', `repo:${repo} is:issue is:open`),
    await search('Open PR count', `repo:${repo} is:pr is:open`),
    await search('Merged PR count', mergedQuery(repo, from)),
  ];
  const release = await optional(
    ctx,
    warnings,
    'Latest release',
    () =>
      ctx.client.rest<{ name: string | null; tag_name: string; html_url: string; published_at: string }>(
        `${base}/releases/latest`,
      ),
    { quietStatus: [404] },
  );
  const exact = (c: Count | null) => (c && !c.incomplete_results ? c.total_count : null);
  const merges: Merge[] = (pulls ?? [])
    .filter((p) => p.merged_at)
    .map((p) => ({ mergedAt: p.merged_at!, createdAt: p.created_at, author: actor(p.user), url: p.html_url }));
  const commitEvents: Event[] = (commits ?? [])
    .filter((c) => c.author && c.author.type !== 'Bot' && !/\[bot\]$/i.test(c.author.login))
    .map((c) => ({ at: c.commit.author.date, url: c.html_url, kind: 'Human commit', login: c.author!.login }));
  return summarize(
    ctx,
    'rest',
    merges,
    commitEvents,
    {
      mergedExact: exact(merged),
      commits: { count: commits ? commits.length : null, limited: commits?.length === 100 },
      openIssues: exact(openIssues),
      openPRs: exact(openPRs),
      release: release
        ? { name: release.name || release.tag_name, url: release.html_url, publishedAt: release.published_at }
        : null,
      warnings,
    },
    pulls !== null,
    // The REST page holds closed PRs, merged or not, so a full page means the
    // merges in it are a sample even when fewer than 100 were merged.
    (pulls?.length ?? 0) >= 100,
  );
}

const OVERVIEW_QUERY = `
query Overview($owner: String!, $name: String!, $since: GitTimestamp!, $merged: String!) {
  repository(owner: $owner, name: $name) {
    isPrivate
    issues(states: OPEN) { totalCount }
    pullRequests(states: OPEN) { totalCount }
    latestRelease { name tagName url publishedAt }
    merged: pullRequests(states: MERGED, first: 100, orderBy: { field: UPDATED_AT, direction: DESC }) {
      nodes { number url createdAt mergedAt ${AUTHOR} mergedBy { login } }
    }
    defaultBranchRef {
      target {
        ... on Commit {
          history(since: $since, first: 20) {
            totalCount
            nodes { committedDate url author { user { login } } }
          }
        }
      }
    }
  }
  mergedCount: search(query: $merged, type: ISSUE, first: 1) { issueCount }
}`;

type OverviewData = {
  repository: {
    isPrivate: boolean;
    issues: { totalCount: number };
    pullRequests: { totalCount: number };
    latestRelease: { name: string | null; tagName: string; url: string; publishedAt: string } | null;
    merged: {
      nodes: Array<{
        number: number;
        url: string;
        createdAt: string;
        mergedAt: string;
        author: { login: string; __typename: string } | null;
        mergedBy: { login: string } | null;
      }>;
    };
    defaultBranchRef: {
      target: {
        history?: {
          totalCount: number;
          nodes: Array<{ committedDate: string; url: string; author: { user: { login: string } | null } | null }>;
        };
      };
    } | null;
  } | null;
  mergedCount: { issueCount: number };
};

async function viaGraphql(ctx: Ctx, repo: string): Promise<OverviewReport> {
  await publicRepo(ctx, repo);
  const from = since(ctx.now.getTime());
  const { data, errors } = await ctx.client.graphql<OverviewData>(OVERVIEW_QUERY, {
    ...splitRepo(repo),
    since: from,
    merged: mergedQuery(repo, from),
  });
  const r = data.repository;
  if (!r || r.isPrivate) throw new Error('Only public repositories are supported.');
  const warnings = errors.map((e) => `Partial data from GitHub: ${e}`);
  const merges: Merge[] = r.merged.nodes.map((m) => ({
    mergedAt: m.mergedAt,
    createdAt: m.createdAt,
    author: actor(m.author),
    url: m.url,
    mergedBy: m.mergedBy?.login ?? null,
  }));
  const history = r.defaultBranchRef?.target.history;
  const commitEvents: Event[] = (history?.nodes ?? [])
    .filter((c) => c.author?.user && !/\[bot\]$/i.test(c.author.user.login))
    .map((c) => ({ at: c.committedDate, url: c.url, kind: 'Human commit', login: c.author!.user!.login }));
  return summarize(
    ctx,
    'graphql',
    merges,
    commitEvents,
    {
      mergedExact: data.mergedCount.issueCount,
      commits: { count: history ? history.totalCount : null, limited: false },
      openIssues: r.issues.totalCount,
      openPRs: r.pullRequests.totalCount,
      release: r.latestRelease
        ? {
            name: r.latestRelease.name || r.latestRelease.tagName,
            url: r.latestRelease.url,
            publishedAt: r.latestRelease.publishedAt,
          }
        : null,
      warnings,
    },
    true,
    r.merged.nodes.length >= 100,
  );
}

export const overview = (ctx: Ctx, repo: string) =>
  preferGraphql(
    ctx,
    () => viaGraphql(ctx, repo),
    () => viaRest(ctx, repo),
  );
