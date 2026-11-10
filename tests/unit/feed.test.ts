import { describe, expect, it } from 'vitest';
import type { DiscoverRow } from '../../src/background/reports/discover';
import type { IssueRow } from '../../src/background/reports/issues';
import { timing } from '../../src/core/metrics';
import {
  badgeFor,
  badgePath,
  buildFeed,
  freeIssues,
  leaderboard,
  parseRepoList,
  replyTime,
  type FeedRepo,
  type Reports,
} from '../../feed/src/feed';

const row = (number: number, extra: Partial<IssueRow> = {}): IssueRow => ({
  number,
  title: `Issue ${number}`,
  url: `https://github.com/acme/widgets/issues/${number}`,
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: `2026-11-0${(number % 9) + 1}T00:00:00Z`,
  labels: ['good first issue'],
  assignees: [],
  comments: 1,
  author: 'rep',
  linkedOpen: 0,
  ...extra,
});
const free = (number: number) => ({ number, tone: 'good' as const, label: 'Looks free', detail: '' });
const found = (repo: string, score: number, merges90: number | null = 10): DiscoverRow => ({
  repo,
  url: `https://github.com/${repo}`,
  description: null,
  stars: 500,
  language: 'Go',
  merges90,
  goodFirstIssues: 4,
  helpWanted: 0,
  score,
});
const feedRepo = (repo: string, hours: number | null, stars = 100): FeedRepo => ({
  repo,
  url: `https://github.com/${repo}`,
  description: null,
  language: 'Go',
  stars,
  merges90: 5,
  reply: hours === null ? null : { hours, basis: 'pull requests', answered: 5, sampled: 8 },
  listed: 'search',
});

describe('feed: what gets listed', () => {
  it('lists only issues that are unassigned, unlinked and "Looks free"', () => {
    const rows = [row(1), row(2, { assignees: ['kim'] }), row(3, { linkedOpen: 1 }), row(4), row(5), row(6), row(7)];
    const verdicts = [
      free(1),
      free(2),
      free(3),
      { number: 4, tone: 'warn' as const, label: 'Claimed by @sam', detail: '' },
      { number: 5, tone: 'unknown' as const, label: 'Partly checked', detail: '' },
      free(6),
      free(7),
    ];
    expect(freeIssues(rows, verdicts).map((r) => r.number)).toEqual([1, 6, 7]);
    expect(freeIssues(rows, verdicts, 2).map((r) => r.number)).toEqual([1, 6]);
    // No verdict (the check failed) is not "free".
    expect(freeIssues([row(9)], [])).toEqual([]);
  });

  it('uses pull request reply times first, issues second, and nothing below three answers', () => {
    expect(replyTime({ pr: timing([2, 4, 9]), issue: timing([1, 1, 1]) })).toEqual({
      hours: 4,
      basis: 'pull requests',
      answered: 3,
      sampled: 3,
    });
    expect(replyTime({ pr: timing([2, null]), issue: timing([5, 7, 30, null]) })).toMatchObject({
      hours: 7,
      basis: 'issues',
      answered: 3,
      sampled: 4,
    });
    expect(replyTime({ pr: timing([2, 4]), issue: timing([]) })).toBeNull();
  });

  it('reads the opt-in list: one repository per line, comments and junk ignored', () => {
    expect(
      parseRepoList(
        '# header\n\nalphasafal/contri\nhttps://github.com/Acme/Widgets  # ours\nnot a repo\nacme/widgets\n',
      ),
    ).toEqual(['alphasafal/contri', 'Acme/Widgets']);
  });
});

describe('feed: ranking and badges', () => {
  it('ranks by fastest reply and never ranks "not enough evidence" as slow', () => {
    const ranked = leaderboard([feedRepo('a/slow', 90), feedRepo('b/unknown', null, 9000), feedRepo('c/fast', 3)]);
    expect(ranked.map((r) => r.repo)).toEqual(['c/fast', 'a/slow', 'b/unknown']);
  });
  it('writes a shields.io endpoint badge that says what it measures', () => {
    expect(badgeFor(feedRepo('c/fast', 3))).toEqual({
      schemaVersion: 1,
      label: 'first reply to contributors',
      message: '~3h',
      color: '2f9e5b',
      cacheSeconds: 21600,
    });
    expect(badgeFor(feedRepo('a/slow', 60)).message).toBe('~2.5d');
    expect(badgeFor(feedRepo('a/slow', 60)).color).toBe('c9941a');
    expect(badgeFor(feedRepo('a/slower', 200)).color).toBe('8a9690');
    expect(badgeFor(feedRepo('b/unknown', null))).toMatchObject({ message: 'not enough data', color: '8a9690' });
    expect(badgePath('Acme/Widgets')).toBe('badge/acme/widgets.json');
  });
});

describe('feed: a whole run', () => {
  const reports = (over: Partial<Reports> = {}): Reports => ({
    discover: async (language) =>
      language === 'Go'
        ? [found('go/low', 5), found('go/high', 50), found('go/dead', 99, 0), found('go/mid', 20)]
        : [found('rust/one', 30)],
    repo: async (repo) => ({
      url: `https://github.com/${repo}`,
      description: 'ours',
      language: 'TypeScript',
      stars: 3,
    }),
    team: async (repo) => ({
      summary: { pr: timing(repo === 'go/high' ? [1, 2, 3] : [40, 50, 60]), issue: timing([]) },
      roster: [],
    }),
    issues: async () => [row(1), row(2), row(3, { assignees: ['kim'] })],
    verdicts: async (_repo, numbers) => numbers.map(free),
    budgetLeft: () => true,
    ...over,
  });

  it('puts opted-in repositories first, takes the best per language in turn, and sorts issues by reply time', async () => {
    const asked: string[] = [];
    const feed = await buildFeed({
      optIn: ['alphasafal/contri'],
      languages: ['Go', 'Rust'],
      perLanguage: 2,
      now: new Date('2026-11-10T00:00:00Z'),
      reports: reports({
        team: async (repo) => {
          asked.push(repo);
          return reports().team(repo);
        },
      }),
    });
    // Opt-in first; then Go's best, Rust's best, Go's second. The repository with no merges is never asked about.
    expect(asked).toEqual(['alphasafal/contri', 'go/high', 'rust/one', 'go/mid']);
    expect(feed.generatedAt).toBe('2026-11-10T00:00:00.000Z');
    expect(feed.repos[0]).toMatchObject({ repo: 'go/high', reply: { hours: 2 }, listed: 'search' });
    expect(feed.repos.find((r) => r.repo === 'alphasafal/contri')).toMatchObject({ listed: 'opt-in', merges90: null });
    // Assigned issue #3 is never sent for a verdict, and the fastest project's issues come first.
    expect(feed.issues).toHaveLength(8);
    expect(feed.issues.slice(0, 2).every((i) => i.repo === 'go/high' && i.replyHours === 2)).toBe(true);
    expect(feed.issues.some((i) => i.number === 3)).toBe(false);
    expect(feed.skipped).toEqual([]);
  });

  it('a repository that fails is skipped with its reason, and the rest is still published', async () => {
    const feed = await buildFeed({
      optIn: ['gone/repo'],
      languages: ['Go'],
      perLanguage: 2,
      reports: reports({
        repo: async () => {
          throw new Error('Not found on GitHub. It may be private, renamed or deleted.');
        },
        team: async (repo) => {
          if (repo === 'go/mid') throw new Error('GitHub returned 502. Try again later.');
          return reports().team(repo);
        },
      }),
    });
    expect(feed.repos.map((r) => r.repo)).toEqual(['go/high']);
    expect(feed.skipped).toEqual([
      { repo: 'gone/repo', reason: 'Not found on GitHub. It may be private, renamed or deleted.' },
      { repo: 'go/mid', reason: 'GitHub returned 502. Try again later.' },
    ]);
  });

  it('stops asking when the request budget runs out, and says which repositories were left', async () => {
    let calls = 0;
    const feed = await buildFeed({
      optIn: [],
      languages: ['Go'],
      perLanguage: 3,
      reports: reports({ budgetLeft: () => ++calls <= 2 }),
    });
    expect(feed.repos.map((r) => r.repo)).toEqual(['go/high']);
    expect(feed.skipped.map((s) => s.repo)).toEqual(['go/mid', 'go/low']);
    expect(feed.skipped[0].reason).toMatch(/budget/);
  });
});
