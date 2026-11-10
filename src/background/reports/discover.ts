import { DAY, discoveryScore, since } from '../../core/metrics';
import { repoPath } from '../../shared/repo';
import { optional, type Ctx } from './context';

export type DiscoverInput = { query: string; language: string; personalize: boolean };

export type DiscoverRow = {
  repo: string;
  url: string;
  description: string | null;
  stars: number;
  language: string | null;
  merges90: number | null;
  goodFirstIssues: number | null;
  helpWanted: number | null;
  score: number;
};

export type DiscoverReport = {
  languages: string[];
  personalized: boolean;
  rows: DiscoverRow[];
  total: number;
  warnings: string[];
  checkedAt: string;
};

const clean = (value: string, pattern: RegExp, max: number) => value.replace(pattern, '').trim().slice(0, max);

export function discoverQuery(input: { query: string; language: string }, now: number) {
  const words = clean(input.query, /[^\p{L}\p{N} _-]/gu, 80);
  const language = clean(input.language, /[^\w+#.-]/g, 30);
  const pushed = new Date(now - 30 * DAY).toISOString().slice(0, 10);
  return [
    words,
    language ? `language:"${language}"` : '',
    'good-first-issues:>=2',
    'archived:false',
    'is:public',
    `pushed:>=${pushed}`,
  ]
    .filter(Boolean)
    .join(' ');
}

/** Top languages of the signed-in user's own recently pushed repositories. */
async function profileLanguages(ctx: Ctx): Promise<string[]> {
  const { data } = await ctx.client.graphql<{
    viewer: { repositories: { nodes: Array<{ primaryLanguage: { name: string } | null }> } };
  }>(
    `query Me { viewer { repositories(first: 40, ownerAffiliations: OWNER, isFork: false, orderBy: { field: PUSHED_AT, direction: DESC }) { nodes { primaryLanguage { name } } } } }`,
    {},
  );
  const counts = new Map<string, number>();
  for (const n of data.viewer.repositories.nodes)
    if (n.primaryLanguage) counts.set(n.primaryLanguage.name, (counts.get(n.primaryLanguage.name) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([name]) => name);
}

type GqlRepo = {
  nameWithOwner?: string;
  url: string;
  description: string | null;
  stargazerCount: number;
  isArchived: boolean;
  primaryLanguage: { name: string } | null;
  gfi: { totalCount: number };
  hw: { totalCount: number };
  pullRequests: { nodes: Array<{ mergedAt: string; author: { __typename: string } | null }> };
};

/** One GraphQL search for repositories matching `q`, with recent human merges and beginner-issue counts for each. */
export async function searchRepositories(
  ctx: Ctx,
  q: string,
  cutoff: number,
): Promise<{ rows: DiscoverRow[]; total: number }> {
  const { data } = await ctx.client.graphql<{ search: { repositoryCount: number; nodes: GqlRepo[] } }>(
    `query Discover($q: String!) {
      search(query: $q, type: REPOSITORY, first: 12) {
        repositoryCount
        nodes { ... on Repository {
          nameWithOwner url description stargazerCount isArchived primaryLanguage { name }
          gfi: issues(states: OPEN, labels: ["good first issue"]) { totalCount }
          hw: issues(states: OPEN, labels: ["help wanted"]) { totalCount }
          pullRequests(states: MERGED, first: 50, orderBy: { field: UPDATED_AT, direction: DESC }) { nodes { mergedAt author { __typename } } }
        } }
      }
    }`,
    { q: `${q} sort:updated-desc` },
  );
  const rows = data.search.nodes
    .filter((n) => n.nameWithOwner)
    .map((n) => {
      const merges90 = n.pullRequests.nodes.filter(
        (p) => p.author?.__typename !== 'Bot' && Date.parse(p.mergedAt) >= cutoff,
      ).length;
      return {
        repo: n.nameWithOwner!,
        url: n.url,
        description: n.description,
        stars: n.stargazerCount,
        language: n.primaryLanguage?.name ?? null,
        merges90,
        goodFirstIssues: n.gfi.totalCount,
        helpWanted: n.hw.totalCount,
        score: discoveryScore({ merges90, goodFirstIssues: n.gfi.totalCount, archived: n.isArchived }),
      };
    });
  return { rows, total: data.search.repositoryCount };
}

type RestRepo = {
  full_name: string;
  html_url: string;
  description: string | null;
  stargazers_count: number;
  language: string | null;
  archived: boolean;
  private: boolean;
};

async function searchRest(ctx: Ctx, q: string, cutoff: number, warnings: string[]) {
  const found = await ctx.client.rest<{ total_count: number; items: RestRepo[] }>(
    `/search/repositories?q=${encodeURIComponent(q)}&sort=help-wanted-issues&order=desc&per_page=6`,
  );
  const rows: DiscoverRow[] = [];
  for (const r of found.items.filter((i) => !i.private)) {
    const pulls = await optional(ctx, warnings, `${r.full_name} activity`, () =>
      ctx.client.rest<Array<{ merged_at: string | null; user: { type?: string; login: string } | null }>>(
        `${repoPath(r.full_name)}/pulls?state=closed&sort=updated&direction=desc&per_page=50`,
      ),
    );
    const merges90 = pulls
      ? pulls.filter(
          (p) =>
            p.merged_at &&
            Date.parse(p.merged_at) >= cutoff &&
            p.user?.type !== 'Bot' &&
            !/\[bot\]$/i.test(p.user?.login ?? ''),
        ).length
      : null;
    rows.push({
      repo: r.full_name,
      url: r.html_url,
      description: r.description,
      stars: r.stargazers_count,
      language: r.language,
      merges90,
      goodFirstIssues: null,
      helpWanted: null,
      score: discoveryScore({ merges90: merges90 ?? 0, goodFirstIssues: 0, archived: r.archived }),
    });
  }
  return { rows, total: found.total_count };
}

export async function discover(ctx: Ctx, input: DiscoverInput): Promise<DiscoverReport> {
  const warnings: string[] = [];
  let languages = input.language ? [input.language] : [];
  let personalized = false;
  if (input.personalize && !input.language) {
    if (!ctx.authed) throw new Error('Sign in with GitHub to match projects to the languages you use.');
    languages = await profileLanguages(ctx);
    personalized = languages.length > 0;
    if (!personalized) warnings.push('No languages found in your public repositories; showing all languages.');
  }
  const cutoff = Date.parse(since(ctx.now.getTime()));
  const languageList = languages.length ? languages : [''];
  const all: DiscoverRow[] = [];
  let total = 0;
  for (const language of languageList) {
    const q = discoverQuery({ query: input.query, language }, ctx.now.getTime());
    const result = ctx.authed ? await searchRepositories(ctx, q, cutoff) : await searchRest(ctx, q, cutoff, warnings);
    total += result.total;
    for (const row of result.rows) if (!all.some((r) => r.repo === row.repo)) all.push(row);
  }
  if (!ctx.authed)
    warnings.push('Anonymous mode compares six projects. Sign in to compare more and see good-first-issue counts.');
  return {
    languages,
    personalized,
    rows: all.sort((a, b) => b.score - a.score).slice(0, 12),
    total,
    warnings,
    checkedAt: new Date().toISOString(),
  };
}
