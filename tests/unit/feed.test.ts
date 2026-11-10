import { describe, expect, it } from 'vitest';
import type { DiscoverRow } from '../../src/background/reports/discover';
import type { IssueRow } from '../../src/background/reports/issues';
import { timing } from '../../src/core/metrics';
import {
  badgeFor,
  badgePath,
  buildFeed,
  carryOver,
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
  reply: hours === null ? null : { hours, basis: 'pull requests', answered: 5, sampled: 8, instant: hours < 0.25 },
  listed: 'search',
  checkedAt: '2026-11-10T00:00:00.000Z',
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
      instant: false,
    });
    // A median under 15 minutes is flagged: it is reported, not ranked.
    expect(replyTime({ pr: timing([0, 0.1, 0.2, 5]), issue: timing([]) })).toMatchObject({ hours: 0.2, instant: true });
    expect(replyTime({ pr: timing([0.25, 0.3, 0.4]), issue: timing([]) })).toMatchObject({ instant: false });
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
  it('keeps "within minutes" projects out of first place: after the measured ones, before the unknown', () => {
    const ranked = leaderboard([
      feedRepo('bot/zero', 0, 10),
      feedRepo('a/slow', 90),
      feedRepo('b/unknown', null),
      feedRepo('bot/big', 0.1, 5000),
      feedRepo('c/fast', 3),
    ]);
    expect(ranked.map((r) => r.repo)).toEqual(['c/fast', 'a/slow', 'bot/big', 'bot/zero', 'b/unknown']);
    expect(badgeFor(feedRepo('bot/zero', 0))).toMatchObject({ message: 'within minutes', color: '2f9e5b' });
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

describe('feed: keeping projects between runs', () => {
  const now = new Date('2026-11-10T00:00:00.000Z');
  const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000).toISOString();
  const old = (repo: string, days: number, extra: Record<string, unknown> = {}) => ({
    ...feedRepo(repo, 6),
    checkedAt: daysAgo(days),
    ...extra,
  });

  it('keeps a project the run did not read, with its old numbers and the day it was read, for 30 days', () => {
    const kept = carryOver(
      [feedRepo('new/today', 3)],
      { generatedAt: daysAgo(1), repos: [old('seen/yesterday', 1), old('seen/long-ago', 31), old('New/Today', 1)] },
      { now, optIn: [] },
    );
    expect(kept.map((r) => [r.repo, r.checkedAt])).toEqual([
      ['new/today', now.toISOString()],
      ['seen/yesterday', daysAgo(1)],
    ]);
    expect(kept[1].reply).toMatchObject({ hours: 6, instant: false });
    // Exactly 30 days is still kept; a list from before `checkedAt` existed uses its own date.
    expect(carryOver([], { repos: [old('a/b', 30)] }, { now, optIn: [] })).toHaveLength(1);
    const legacy = { ...feedRepo('legacy/list', 6) } as Record<string, unknown>;
    delete legacy.checkedAt;
    expect(carryOver([], { generatedAt: daysAgo(2), repos: [legacy] }, { now, optIn: [] })[0].checkedAt).toBe(
      daysAgo(2),
    );
  });

  it('drops a project its maintainers removed from the opt-in list, and keeps one still on it', () => {
    const previous = {
      generatedAt: daysAgo(1),
      repos: [old('left/list', 1, { listed: 'opt-in' }), old('Still/Listed', 1, { listed: 'opt-in' })],
    };
    expect(carryOver([], previous, { now, optIn: ['still/listed'] }).map((r) => r.repo)).toEqual(['Still/Listed']);
  });

  it('reads the published file back as untrusted data', () => {
    const previous = {
      generatedAt: daysAgo(1),
      repos: [
        null,
        'text',
        { repo: 'not a repo', listed: 'search', checkedAt: daysAgo(1) },
        { repo: 'x/future', listed: 'search', checkedAt: new Date(now.getTime() + 86_400_000).toISOString() },
        { repo: 'x/odd-kind', listed: 'sponsored', checkedAt: daysAgo(1) },
        {
          repo: 'ok/repo',
          url: 'javascript:alert(1)',
          description: 7,
          language: 'Go',
          stars: -5,
          merges90: 'many',
          reply: { hours: 'fast', basis: 'pull requests', answered: 3, sampled: 3 },
          listed: 'search',
          checkedAt: daysAgo(3),
        },
        { ...old('ok/instant', 2), reply: { hours: 0.1, basis: 'issues', answered: 4, sampled: 5 } },
      ],
    };
    const kept = carryOver([], previous, { now, optIn: [] });
    expect(kept.map((r) => r.repo)).toEqual(['ok/instant', 'ok/repo']);
    // The URL is rebuilt from the name, and anything that is not the expected type is dropped.
    expect(kept[1]).toEqual({
      repo: 'ok/repo',
      url: 'https://github.com/ok/repo',
      description: null,
      language: 'Go',
      stars: 0,
      merges90: null,
      reply: null,
      listed: 'search',
      checkedAt: daysAgo(3),
    });
    expect(kept[0].reply).toEqual({ hours: 0.1, basis: 'issues', answered: 4, sampled: 5, instant: true });
    expect(carryOver([feedRepo('a/b', 1)], null, { now, optIn: [] })).toHaveLength(1);
    expect(carryOver([feedRepo('a/b', 1)], { repos: 'broken' }, { now, optIn: [] })).toHaveLength(1);
  });

  it('never grows past the cap, dropping what has gone longest without a look', () => {
    const many = Array.from({ length: 320 }, (_, i) => old(`org/repo-${i}`, 1 + (i % 29)));
    const kept = carryOver([feedRepo('new/today', 3)], { generatedAt: daysAgo(1), repos: many }, { now, optIn: [] });
    expect(kept).toHaveLength(300);
    expect(kept[0].repo).toBe('new/today');
    expect(kept.at(-1)!.checkedAt >= daysAgo(29)).toBe(true);
    expect(kept.some((r) => r.checkedAt === daysAgo(29))).toBe(false);
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

  it('lists the issues of a "within minutes" project after those of measured projects', async () => {
    const feed = await buildFeed({
      optIn: [],
      languages: ['Go'],
      perLanguage: 2,
      reports: reports({
        team: async (repo) => ({
          summary: { pr: timing(repo === 'go/high' ? [0, 0, 0.1] : [40, 50, 60]), issue: timing([]) },
          roster: [],
        }),
      }),
    });
    expect(feed.repos.map((r) => [r.repo, r.reply?.instant])).toEqual([
      ['go/mid', false],
      ['go/high', true],
    ]);
    expect(feed.issues.map((i) => i.repo)).toEqual(['go/mid', 'go/mid', 'go/high', 'go/high']);
    expect(feed.issues[2]).toMatchObject({ replyHours: 0, replyInstant: true });
  });

  it('a run publishes what it read plus recent projects from the previous list, ranked together', async () => {
    const now = new Date('2026-11-10T00:00:00.000Z');
    const yesterday = '2026-11-09T00:00:00.000Z';
    const feed = await buildFeed({
      optIn: [],
      languages: ['Go'],
      perLanguage: 1,
      now,
      previous: {
        generatedAt: yesterday,
        repos: [
          { ...feedRepo('kept/faster', 1), checkedAt: yesterday },
          { ...feedRepo('go/high', 99), checkedAt: yesterday },
        ],
      },
      reports: reports(),
    });
    // The project read today replaces its old entry; the other one keeps yesterday's number and date.
    expect(feed.repos.map((r) => [r.repo, r.reply?.hours, r.checkedAt])).toEqual([
      ['kept/faster', 1, yesterday],
      ['go/high', 2, now.toISOString()],
    ]);
    // Issues are only ever today's: "looked free" does not keep.
    expect(feed.issues.every((i) => i.repo === 'go/high')).toBe(true);
  });

  it('keeps a project in the ranking when only its issues could not be read', async () => {
    const feed = await buildFeed({
      optIn: [],
      languages: ['Go'],
      perLanguage: 1,
      reports: reports({
        issues: async () => {
          throw new Error('GitHub could not run this search. Try simpler terms.');
        },
      }),
    });
    expect(feed.repos).toHaveLength(1);
    expect(feed.repos[0]).toMatchObject({ repo: 'go/high', reply: { hours: 2 } });
    expect(feed.issues).toEqual([]);
    expect(feed.skipped).toEqual([
      { repo: 'go/high', reason: 'Open issues were not read: GitHub could not run this search. Try simpler terms.' },
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
