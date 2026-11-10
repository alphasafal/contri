import type { DiscoverRow } from '../../src/background/reports/discover';
import type { ListVerdict } from '../../src/background/reports/insight';
import type { IssueRow } from '../../src/background/reports/issues';
import type { TeamReport } from '../../src/background/reports/team';
import type { Timing } from '../../src/core/metrics';
import { hours } from '../../src/shared/format';
import { parseRepo } from '../../src/shared/repo';

/**
 * The public data set behind the website's "Free right now" list, the reply-time
 * leaderboard and the README badges. Built by a scheduled workflow from the same reports
 * as the extension and published as static JSON: there is still no CONTRI server.
 *
 * Everything here is pure. `main.ts` supplies the reports and writes the files.
 */

export const LANGUAGES = ['TypeScript', 'JavaScript', 'Python', 'Go', 'Rust', 'Java', 'C++', 'C#', 'PHP', 'Ruby'];
/** Per language. The whole run is paced by GitHub's per-minute search limit: about eight projects a minute. */
export const REPOS_PER_LANGUAGE = 5;
/** Projects found by search need this many stars, so the lists are not filled by brand-new or throwaway repositories. Opted-in projects do not. */
export const MIN_STARS = 200;
export const ISSUES_PER_REPO = 3;
const CANDIDATE_ISSUES = 12;

/** How quickly the project team first replies to outside contributors, and how much that rests on. */
export type ReplyTime = { hours: number; basis: 'pull requests' | 'issues'; answered: number; sampled: number };

export type FeedRepo = {
  repo: string;
  url: string;
  description: string | null;
  language: string | null;
  stars: number;
  /** Human merges among the latest 50 merged PRs in the last 90 days; null when unknown. */
  merges90: number | null;
  /** Null when fewer than three sampled items got a team reply: not enough evidence, never "slow". */
  reply: ReplyTime | null;
  /** Why this repository is listed: found by search, or added to feed/repos.txt by its maintainers. */
  listed: 'search' | 'opt-in';
};

export type FeedIssue = {
  repo: string;
  number: number;
  title: string;
  url: string;
  labels: string[];
  comments: number;
  updatedAt: string;
  language: string | null;
  stars: number;
  replyHours: number | null;
};

export type Feed = {
  generatedAt: string;
  repos: FeedRepo[];
  issues: FeedIssue[];
  /** Repositories that could not be read this run, and why. Shown on the page, never hidden. */
  skipped: Array<{ repo: string; reason: string }>;
};

/** Prefers pull requests (that is what a contributor will open); falls back to issues. */
export function replyTime(summary: { pr: Timing; issue: Timing }): ReplyTime | null {
  for (const [basis, t] of [
    ['pull requests', summary.pr],
    ['issues', summary.issue],
  ] as const)
    if (t.sufficient && t.medianHours !== null)
      return { hours: Math.round(t.medianHours * 10) / 10, basis, answered: t.answered, sampled: t.sampled };
  return null;
}

/** `feed/repos.txt`: one owner/name per line; `#` starts a comment. Invalid lines are ignored. */
export function parseRepoList(text: string): string[] {
  const seen = new Map<string, string>();
  for (const raw of text.split('\n')) {
    const repo = parseRepo(raw.replace(/#.*/, '').trim());
    if (repo && !seen.has(repo.toLowerCase())) seen.set(repo.toLowerCase(), repo);
  }
  return [...seen.values()];
}

/**
 * Issues worth listing: unassigned, no linked open pull request, and "Looks free" by the
 * same verdict the extension shows (no claim, no maintainer on it, nothing partly checked).
 */
export function freeIssues(rows: IssueRow[], verdicts: ListVerdict[], limit = ISSUES_PER_REPO): IssueRow[] {
  const good = new Set(verdicts.filter((v) => v.tone === 'good' && v.label === 'Looks free').map((v) => v.number));
  return rows.filter((r) => !r.assignees.length && !r.linkedOpen && good.has(r.number)).slice(0, limit);
}

export type Reports = {
  discover(language: string): Promise<DiscoverRow[]>;
  repo(repo: string): Promise<{ url: string; description: string | null; language: string | null; stars: number }>;
  team(repo: string): Promise<Pick<TeamReport, 'summary' | 'roster'>>;
  issues(repo: string): Promise<IssueRow[]>;
  verdicts(repo: string, numbers: number[], roster: TeamReport['roster']): Promise<ListVerdict[]>;
  /** False when the request budget is nearly spent: stop adding repositories, publish what there is. */
  budgetLeft(): boolean;
};

export async function buildFeed(input: {
  reports: Reports;
  optIn: string[];
  languages?: string[];
  perLanguage?: number;
  now?: Date;
  log?: (line: string) => void;
}): Promise<Feed> {
  const { reports, optIn, log = () => {} } = input;
  const skipped: Feed['skipped'] = [];
  const candidates = new Map<string, FeedRepo>();
  const add = (row: FeedRepo) => {
    if (!candidates.has(row.repo.toLowerCase())) candidates.set(row.repo.toLowerCase(), row);
  };

  // Opted-in repositories first, so a tight budget never drops the people who asked to be listed.
  for (const repo of optIn) {
    try {
      add({ repo, ...(await reports.repo(repo)), merges90: null, reply: null, listed: 'opt-in' });
    } catch (error) {
      skipped.push({ repo, reason: (error as Error).message });
    }
  }
  // Found by search, then taken one language at a time in turn: if the budget runs out
  // half-way, every language has lost its last pick instead of some languages losing all.
  const perLanguage: FeedRepo[][] = [];
  for (const language of input.languages ?? LANGUAGES) {
    if (!reports.budgetLeft()) break;
    try {
      const rows = (await reports.discover(language))
        .filter((r) => (r.merges90 ?? 0) > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, input.perLanguage ?? REPOS_PER_LANGUAGE);
      perLanguage.push(
        rows.map((r) => ({
          repo: r.repo,
          url: r.url,
          description: r.description,
          language: r.language,
          stars: r.stars,
          merges90: r.merges90,
          reply: null,
          listed: 'search' as const,
        })),
      );
      log(`${language}: ${rows.length} repositories`);
    } catch (error) {
      skipped.push({ repo: `language:${language}`, reason: (error as Error).message });
    }
  }
  for (let i = 0; perLanguage.some((rows) => i < rows.length); i++)
    for (const rows of perLanguage) if (rows[i]) add(rows[i]);

  const repos: FeedRepo[] = [];
  const issues: FeedIssue[] = [];
  for (const row of candidates.values()) {
    if (!reports.budgetLeft()) {
      skipped.push({ repo: row.repo, reason: 'Request budget for this run was used up.' });
      continue;
    }
    let team: Awaited<ReturnType<Reports['team']>>;
    try {
      team = await reports.team(row.repo);
    } catch (error) {
      skipped.push({ repo: row.repo, reason: (error as Error).message });
      continue;
    }
    const reply = replyTime(team.summary);
    repos.push({ ...row, reply });
    // The reply time stands on its own: a project stays in the ranking even if its issues cannot be read.
    try {
      const open = (await reports.issues(row.repo)).filter((r) => !r.assignees.length && !r.linkedOpen);
      const numbers = open.slice(0, CANDIDATE_ISSUES).map((r) => r.number);
      const verdicts = numbers.length ? await reports.verdicts(row.repo, numbers, team.roster) : [];
      const free = freeIssues(open, verdicts);
      for (const r of free)
        issues.push({
          repo: row.repo,
          number: r.number,
          title: r.title,
          url: r.url,
          labels: r.labels,
          comments: r.comments,
          updatedAt: r.updatedAt,
          language: row.language,
          stars: row.stars,
          replyHours: reply?.hours ?? null,
        });
      log(`${row.repo}: reply ${reply ? hours(reply.hours) : 'unknown'}, ${free.length} free issues`);
    } catch (error) {
      skipped.push({ repo: row.repo, reason: `Open issues were not read: ${(error as Error).message}` });
    }
  }

  return {
    generatedAt: (input.now ?? new Date()).toISOString(),
    repos: leaderboard(repos),
    // Projects that answer newcomers fastest first; unknown reply times last, then most recently updated.
    issues: issues.sort(
      (a, b) =>
        (a.replyHours ?? Infinity) - (b.replyHours ?? Infinity) || Date.parse(b.updatedAt) - Date.parse(a.updatedAt),
    ),
    skipped,
  };
}

/** Fastest median first reply first. Repositories without enough evidence go last, never ranked as slow. */
export function leaderboard(repos: FeedRepo[]): FeedRepo[] {
  return [...repos].sort((a, b) => (a.reply?.hours ?? Infinity) - (b.reply?.hours ?? Infinity) || b.stars - a.stars);
}

/** A shields.io "endpoint" badge: https://img.shields.io/endpoint?url=<this file's URL>. */
export type Badge = { schemaVersion: 1; label: string; message: string; color: string; cacheSeconds: number };

export function badgeFor(repo: FeedRepo): Badge {
  const base = { schemaVersion: 1 as const, label: 'first reply to contributors', cacheSeconds: 21_600 };
  if (!repo.reply) return { ...base, message: 'not enough data', color: '8a9690' };
  const h = repo.reply.hours;
  return { ...base, message: `~${hours(h)}`, color: h <= 24 ? '2f9e5b' : h <= 72 ? 'c9941a' : '8a9690' };
}

/** Where a repository's badge file lives in the published data: lower-case, so the URL is predictable. */
export const badgePath = (repo: string) => `badge/${repo.toLowerCase()}.json`;
