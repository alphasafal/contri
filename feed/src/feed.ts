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
/** Per language. GitHub's per-minute search limit sets the pace: in practice about two projects a minute. */
export const REPOS_PER_LANGUAGE = 4;
/** Projects found by search need this many stars, so the lists are not filled by brand-new or throwaway repositories. Opted-in projects do not. */
export const MIN_STARS = 500;
export const ISSUES_PER_REPO = 3;
const CANDIDATE_ISSUES = 12;

/**
 * A median first reply faster than this is almost never a person reading a pull request:
 * it is automation posting from an account GitHub does not mark as a bot. Such projects are
 * shown, but in a group of their own instead of at the top of a ranking they did not earn.
 */
export const INSTANT_HOURS = 0.25;

/** How quickly the project team first replies to outside contributors, and how much that rests on. */
export type ReplyTime = {
  hours: number;
  basis: 'pull requests' | 'issues';
  answered: number;
  sampled: number;
  /** True when the median is under 15 minutes: reported as "within minutes", not ranked. */
  instant: boolean;
};

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
  /** When this project was last read. Older than the run when it was carried over from an earlier one. */
  checkedAt: string;
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
  /** The reply time is "within minutes" (see INSTANT_HOURS): shown as such, sorted after measured ones. */
  replyInstant: boolean;
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
      return {
        hours: Math.round(t.medianHours * 10) / 10,
        basis,
        answered: t.answered,
        sampled: t.sampled,
        instant: t.medianHours < INSTANT_HOURS,
      };
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
  /** False when the run's time or request budget is nearly spent: stop adding repositories, publish what there is. */
  budgetLeft(): boolean;
};

export async function buildFeed(input: {
  reports: Reports;
  optIn: string[];
  languages?: string[];
  perLanguage?: number;
  /** The data set published by the previous run, if any: see `carryOver`. */
  previous?: { generatedAt?: unknown; repos?: unknown } | null;
  now?: Date;
  log?: (line: string) => void;
}): Promise<Feed> {
  const { reports, optIn, log = () => {} } = input;
  const now = input.now ?? new Date();
  const checkedAt = now.toISOString();
  const skipped: Feed['skipped'] = [];
  const candidates = new Map<string, FeedRepo>();
  const add = (row: FeedRepo) => {
    if (!candidates.has(row.repo.toLowerCase())) candidates.set(row.repo.toLowerCase(), row);
  };

  // Opted-in repositories first, so a tight budget never drops the people who asked to be listed.
  for (const repo of optIn) {
    try {
      add({ repo, ...(await reports.repo(repo)), merges90: null, reply: null, listed: 'opt-in', checkedAt });
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
          checkedAt,
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
      skipped.push({ repo: row.repo, reason: "The run's time budget was used up before this project." });
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
          replyInstant: reply?.instant ?? false,
        });
      log(`${row.repo}: reply ${reply ? hours(reply.hours) : 'unknown'}, ${free.length} free issues`);
    } catch (error) {
      skipped.push({ repo: row.repo, reason: `Open issues were not read: ${(error as Error).message}` });
    }
  }

  const kept = carryOver(repos, input.previous, { now, optIn });
  if (kept.length > repos.length)
    log(`Kept ${kept.length - repos.length} projects read in the last ${KEEP_DAYS} days.`);
  return {
    generatedAt: checkedAt,
    repos: leaderboard(kept),
    // Projects that answer newcomers fastest first, then "within minutes", then unknown; newest update breaks ties.
    issues: issues.sort(
      (a, b) =>
        rankKey(a.replyHours, a.replyInstant) - rankKey(b.replyHours, b.replyInstant) ||
        Date.parse(b.updatedAt) - Date.parse(a.updatedAt),
    ),
    skipped,
  };
}

/** A project stays listed, and its README badge keeps working, this long after it was last read. */
export const KEEP_DAYS = 30;
/** The most projects the published list holds; the longest-unread carried-over ones go first. */
export const MAX_REPOS = 300;

const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0;

/**
 * Search returns whichever active projects were updated most recently, so the set changes
 * from run to run. Without this, a project's README badge would break on the first day it
 * was not picked. Projects from the previous data set that this run did not read are kept,
 * with their old numbers and the date they were read, until `KEEP_DAYS` have passed.
 *
 * A project this run tried and could not read is kept too (GitHub may just have been down).
 * A project that left the opt-in list is dropped at once: its maintainers asked for that.
 */
export function carryOver(
  current: FeedRepo[],
  previous: { generatedAt?: unknown; repos?: unknown } | null | undefined,
  options: { now: Date; optIn: string[] },
): FeedRepo[] {
  if (!previous || !Array.isArray(previous.repos)) return current;
  const have = new Set(current.map((r) => r.repo.toLowerCase()));
  const optedIn = new Set(options.optIn.map((r) => r.toLowerCase()));
  const cutoff = options.now.getTime() - KEEP_DAYS * 86_400_000;
  const older: FeedRepo[] = [];
  for (const raw of previous.repos as Array<Partial<FeedRepo> | null>) {
    // Published data is read back as untrusted JSON: keep only entries with the shape this code writes.
    const repo = text(raw?.repo) ? parseRepo(raw.repo) : null;
    if (!raw || !repo || have.has(repo.toLowerCase())) continue;
    if (raw.listed !== 'search' && raw.listed !== 'opt-in') continue;
    if (raw.listed === 'opt-in' && !optedIn.has(repo.toLowerCase())) continue;
    const read = text(raw.checkedAt) ? raw.checkedAt : text(previous.generatedAt) ? previous.generatedAt : '';
    const at = Date.parse(read);
    if (!Number.isFinite(at) || at < cutoff || at > options.now.getTime()) continue;
    const reply = raw.reply;
    const validReply =
      reply &&
      typeof reply.hours === 'number' &&
      Number.isFinite(reply.hours) &&
      reply.hours >= 0 &&
      (reply.basis === 'pull requests' || reply.basis === 'issues') &&
      Number.isInteger(reply.answered) &&
      Number.isInteger(reply.sampled);
    have.add(repo.toLowerCase());
    older.push({
      repo,
      url: `https://github.com/${repo}`,
      description: text(raw.description) ? raw.description : null,
      language: text(raw.language) ? raw.language : null,
      stars: typeof raw.stars === 'number' && raw.stars >= 0 ? Math.floor(raw.stars) : 0,
      merges90: typeof raw.merges90 === 'number' && raw.merges90 >= 0 ? Math.floor(raw.merges90) : null,
      reply: validReply
        ? {
            hours: reply.hours,
            basis: reply.basis,
            answered: reply.answered,
            sampled: reply.sampled,
            instant: reply.hours < INSTANT_HOURS,
          }
        : null,
      listed: raw.listed,
      checkedAt: new Date(at).toISOString(),
    });
  }
  // Most recently read first, so the cap drops what has gone longest without a look.
  older.sort((a, b) => Date.parse(b.checkedAt) - Date.parse(a.checkedAt));
  return [...current, ...older.slice(0, Math.max(0, MAX_REPOS - current.length))];
}

/** Measured times in order, then every "within minutes" project together, then unknown. */
const rankKey = (hours: number | null, instant: boolean) =>
  hours === null ? Number.MAX_VALUE : instant ? Number.MAX_VALUE / 2 : hours;

/**
 * Fastest measured median first. Projects that reply "within minutes" follow as a group
 * (largest first), because that number is usually automation and not a ranking of people.
 * Projects without enough evidence go last and are never ranked as slow.
 */
export function leaderboard(repos: FeedRepo[]): FeedRepo[] {
  return [...repos].sort(
    (a, b) =>
      rankKey(a.reply?.hours ?? null, a.reply?.instant ?? false) -
        rankKey(b.reply?.hours ?? null, b.reply?.instant ?? false) || b.stars - a.stars,
  );
}

/** A shields.io "endpoint" badge: https://img.shields.io/endpoint?url=<this file's URL>. */
export type Badge = { schemaVersion: 1; label: string; message: string; color: string; cacheSeconds: number };

export function badgeFor(repo: FeedRepo): Badge {
  const base = { schemaVersion: 1 as const, label: 'first reply to contributors', cacheSeconds: 21_600 };
  if (!repo.reply) return { ...base, message: 'not enough data', color: '8a9690' };
  if (repo.reply.instant) return { ...base, message: 'within minutes', color: '2f9e5b' };
  const h = repo.reply.hours;
  return { ...base, message: `~${hours(h)}`, color: h <= 24 ? '2f9e5b' : h <= 72 ? 'c9941a' : '8a9690' };
}

/** Where a repository's badge file lives in the published data: lower-case, so the URL is predictable. */
export const badgePath = (repo: string) => `badge/${repo.toLowerCase()}.json`;
