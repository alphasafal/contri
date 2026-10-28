import { describe, expect, it } from 'vitest';
import { parsePage, parseRepo, safeHref } from '../../src/shared/repo';
import { needsBadgeTimer } from '../../src/content/badges';
import {
  activity,
  actor,
  discoveryScore,
  firstTeamReply,
  hasNextIssuePage,
  linkState,
  needsLinkCheck,
  recentMerges,
  timing,
  type Reply,
  type Thread,
} from '../../src/core/metrics';
import { buildRoster, parseCodeowners, rosterFromEvents, teamCheck } from '../../src/core/team';
import { isFresh, isPartial, ttlFor } from '../../src/core/cache-policy';
import { DAY, isoAgo } from './helpers';
import { hours } from '../../src/shared/format';

describe('repository parsing', () => {
  it('accepts names and GitHub URLs, rejects GitHub product pages', () => {
    expect(parseRepo('pallets/flask')).toBe('pallets/flask');
    expect(parseRepo('https://github.com/pallets/flask/issues/12')).toBe('pallets/flask');
    expect(parseRepo('github.com/pallets/flask.git')).toBe('pallets/flask');
    expect(parseRepo('https://gitlab.com/a/b')).toBeNull();
    expect(parseRepo('settings/profile')).toBeNull();
    expect(parseRepo('orgs/acme')).toBeNull();
    expect(parseRepo('a/..')).toBeNull();
  });
  it('describes repository, issue and pull request pages', () => {
    expect(parsePage('https://github.com/a/b/issues/42')).toEqual({ repo: 'a/b', issue: 42, pull: null });
    expect(parsePage('https://github.com/a/b/pull/7/files')).toEqual({ repo: 'a/b', issue: null, pull: 7 });
    expect(parsePage('https://github.com/a/b')).toEqual({ repo: 'a/b', issue: null, pull: null });
    expect(parsePage('https://github.com/a/b/issues/new').issue).toBeNull();
    expect(parsePage('https://github.com/notifications').repo).toBeNull();
    for (const href of [
      'https://github.com/copilot/c/abc',
      'https://github.com/advisories/GHSA-xxxx-yyyy-zzzz',
      'https://github.com/stars/octocat/lists/tools',
      'https://github.com/sessions/two-factor',
      'https://github.com/solutions/use-case/devops',
    ])
      expect(parsePage(href).repo).toBeNull();
  });
});

describe('badge timer', () => {
  it('runs only on repository pages with badges enabled', () => {
    const on = { mode: 'smart' as const, signedIn: false };
    expect(needsBadgeTimer(on, 'https://github.com/acme/widgets/issues/7')).toBe(true);
    expect(needsBadgeTimer(on, 'https://github.com/')).toBe(false);
    expect(needsBadgeTimer(on, 'https://github.com/notifications')).toBe(false);
    expect(needsBadgeTimer(on, 'https://github.com/settings/profile')).toBe(false);
    expect(needsBadgeTimer({ ...on, mode: 'off' }, 'https://github.com/acme/widgets')).toBe(false);
    expect(needsBadgeTimer(null, 'https://github.com/acme/widgets')).toBe(false);
  });
});

describe('safe links', () => {
  it('only renders https links from API data', () => {
    expect(safeHref('https://github.com/a/b/pull/1')).toBe('https://github.com/a/b/pull/1');
    expect(safeHref('javascript:alert(1)')).toBeUndefined();
    expect(safeHref('JaVaScRiPt:alert(1)')).toBeUndefined();
    expect(safeHref('data:text/html,<script>alert(1)</script>')).toBeUndefined();
    expect(safeHref('http://github.com/a/b')).toBeUndefined();
    expect(safeHref('https://evil.example/github.com')).toBeUndefined();
    expect(safeHref('https://github.com.evil.example/a')).toBeUndefined();
    expect(safeHref('https://user:pw@github.com/a')).toBeUndefined();
    expect(safeHref('https://gist.github.com/a/b')).toBe('https://gist.github.com/a/b');
    expect(safeHref('https://user:pass@github.com/')).toBeUndefined();
    expect(safeHref('p8')).toBeUndefined();
    expect(safeHref('')).toBeUndefined();
    expect(safeHref(null)).toBeUndefined();
  });
});

describe('recent merges', () => {
  it('the newest four weekly buckets cover exactly the last 28 days', () => {
    const now = new Date('2026-10-28T12:00:00Z');
    const at = (daysAgo: number) => new Date(now.getTime() - daysAgo * 86_400_000).toISOString();
    const merge = (daysAgo: number) => ({
      mergedAt: at(daysAgo),
      createdAt: at(daysAgo + 1),
      author: { login: 'a', bot: false },
      url: '',
    });
    // One merge just inside 28 days, one just outside, one at the start of the 90-day window.
    const sample = activity([merge(27.9), merge(28.1), merge(89.5)], now);
    expect(recentMerges({ available: true, weeks: sample.weeks })).toBe(1);
    expect(sample.merged).toBe(3);
    expect(sample.weeks.reduce((n, w) => n + w.count, 0)).toBe(3);
  });

  it('never turns a missing merge sample into zero', () => {
    const weeks = Array.from({ length: 13 }, (_, i) => ({ from: '', count: i >= 11 ? 2 : 1 }));
    expect(recentMerges({ available: true, weeks })).toBe(6);
    expect(recentMerges({ available: true, weeks: weeks.map((w) => ({ ...w, count: 0 })) })).toBe(0);
    expect(recentMerges({ available: false, weeks: weeks.map((w) => ({ ...w, count: 0 })) })).toBeNull();
  });
});

describe('activity and timing', () => {
  const now = new Date('2026-10-15T12:00:00Z');
  const merge = (days: number, login = 'dev', bot = false) => ({
    mergedAt: isoAgo(days, now.getTime()),
    createdAt: isoAgo(days + 2, now.getTime()),
    author: { login, bot },
    url: 'https://github.com/a/b/pull/1',
  });
  it('counts recent human merges and distinct authors only', () => {
    const result = activity([merge(1), merge(2, 'Dev'), merge(3, 'dependabot', true), merge(200)], now);
    expect(result.merged).toBe(2);
    expect(result.authors).toBe(1);
    expect(result.weeks.reduce((n, w) => n + w.count, 0)).toBe(2);
    expect(result.weeks).toHaveLength(13);
  });
  it('keeps unanswered items out of averages and needs three answers', () => {
    expect(timing([1, 2, 99, null])).toEqual({
      sampled: 4,
      answered: 3,
      unanswered: 1,
      averageHours: 34,
      medianHours: 2,
      sufficient: true,
    });
    expect(timing([1, null]).sufficient).toBe(false);
  });
  it('recognizes bots from REST and GraphQL shapes', () => {
    expect(actor({ login: 'dependabot[bot]', type: 'Bot' })?.bot).toBe(true);
    expect(actor({ login: 'renovate', __typename: 'Bot' })?.bot).toBe(true);
    expect(actor({ login: 'octocat', __typename: 'User' })?.bot).toBe(false);
    expect(actor(null)).toBeNull();
  });
});

describe('first team reply', () => {
  const created = isoAgo(10);
  const reply = (login: string, association: string, hoursAfter: number, kind: Reply['kind'] = 'comment'): Reply => ({
    author: { login, bot: login.endsWith('[bot]') },
    association,
    at: new Date(Date.parse(created) + hoursAfter * 3_600_000).toISOString(),
    url: `https://github.com/a/b/issues/1#${login}`,
    kind,
  });
  const thread = (replies: Reply[]): Thread => ({
    kind: 'pr',
    number: 1,
    title: 't',
    url: 'u',
    createdAt: created,
    author: { login: 'newbie', bot: false },
    association: 'FIRST_TIME_CONTRIBUTOR',
    replies,
    complete: true,
  });
  it('ignores the author, bots and outside commenters', () => {
    const roster = buildRoster({});
    const result = firstTeamReply(
      thread([
        reply('newbie', 'NONE', 1),
        reply('ci[bot]', 'MEMBER', 2),
        reply('random', 'NONE', 3),
        reply('maint', 'MEMBER', 5, 'review'),
      ]),
      teamCheck(roster),
    );
    expect(result.hours).toBe(5);
    expect(result.reply?.author?.login).toBe('maint');
  });
  it('counts private org members found through triage events (shown as CONTRIBUTOR)', () => {
    const roster = buildRoster({
      events: [{ event: 'labeled', actor: { login: 'hidden-member', bot: false }, at: isoAgo(3) }],
    });
    const result = firstTeamReply(thread([reply('hidden-member', 'CONTRIBUTOR', 4)]), teamCheck(roster));
    expect(result.hours).toBe(4);
  });
});

describe('maintainer roster', () => {
  it('uses privileged events but skips labels applied by issue forms at creation', () => {
    const created = isoAgo(5);
    const found = rosterFromEvents([
      {
        event: 'labeled',
        actor: { login: 'author', bot: false },
        at: created,
        issueAuthor: 'author',
        issueCreatedAt: created,
      },
      { event: 'assigned', actor: { login: 'triager', bot: false }, at: isoAgo(4) },
      { event: 'merged', actor: { login: 'merger', bot: false }, at: isoAgo(4) },
      { event: 'commented', actor: { login: 'someone', bot: false }, at: isoAgo(4) },
      { event: 'labeled', actor: { login: 'github-actions[bot]', bot: true }, at: isoAgo(4) },
    ]);
    expect(found).toEqual([
      { login: 'triager', basis: 'triage' },
      { login: 'merger', basis: 'merged' },
    ]);
  });
  it('parses CODEOWNERS users and skips teams and comments', () => {
    const text = '# owners\n*.ts @alice @acme/core\n/docs/ @Bob # docs lead\n\n* bad@example.com';
    expect(parseCodeowners(text)).toEqual(['alice', 'Bob']);
  });
  it('treats a user-owned repository owner as team but not an organization', () => {
    expect(buildRoster({ owner: { login: 'solo', type: 'User' } }).has('solo')).toBe(true);
    expect(buildRoster({ owner: { login: 'acme', type: 'Organization' } }).has('acme')).toBe(false);
  });
  it('merges bases for the same person case-insensitively', () => {
    const roster = buildRoster({
      codeowners: ['Alice'],
      mergedBy: ['alice'],
      associations: [{ login: 'ALICE', association: 'MEMBER' }],
    });
    expect(roster.get('alice')?.basis).toEqual(['codeowners', 'merged', 'association']);
  });
});

describe('link checks and paging', () => {
  it('never reports an incomplete check as clear', () => {
    expect(linkState([], false)).toBe('incomplete');
    expect(linkState([{ state: 'closed' }], true)).toBe('clear');
    expect(linkState([{ state: 'OPEN' }], false)).toBe('open');
    expect(needsLinkCheck(undefined)).toBe(true);
    expect(needsLinkCheck({ state: 'incomplete' })).toBe(true);
    expect(needsLinkCheck({ state: 'clear' })).toBe(false);
  });
  it('keeps paging when a full page contained filtered rows', () => {
    expect(hasNextIssuePage(30, 31, 1)).toBe(true);
    expect(hasNextIssuePage(0, 0, 1)).toBe(false);
    expect(hasNextIssuePage(30, 900, 10)).toBe(false);
  });
  it('ranks discovery by merges then beginner issues, archived last', () => {
    expect(discoveryScore({ merges90: 10, goodFirstIssues: 5 })).toBeGreaterThan(
      discoveryScore({ merges90: 2, goodFirstIssues: 10 }),
    );
    expect(discoveryScore({ merges90: 99, goodFirstIssues: 99, archived: true })).toBe(-1);
  });
});

describe('cache policy', () => {
  it('caches partial reports for a shorter time instead of never', () => {
    expect(ttlFor('team', true)).toBe(ttlFor('team', false) / 3);
    expect(isPartial({ warnings: ['limited'] })).toBe(true);
    expect(isPartial({ state: 'incomplete' })).toBe(true);
    expect(isPartial({ warnings: [] })).toBe(false);
    // A note about the mode is not missing data: the anonymous team report keeps its full 6 hours.
    expect(isPartial({ warnings: ['Anonymous mode samples 10 items of each kind. Sign in to sample 20.'] })).toBe(
      false,
    );
    expect(isPartial({ warnings: ['Anonymous mode compares six projects.', 'Issue sample unavailable.'] })).toBe(true);
    expect(isFresh({ at: Date.now() - 1000, ttl: 5000 })).toBe(true);
    expect(isFresh({ at: Date.now() - DAY, ttl: 5000 })).toBe(false);
    expect(isFresh(undefined)).toBe(false);
  });
});

describe('duration format', () => {
  it('rolls over to the next unit after rounding', () => {
    expect(hours(null)).toBe('—');
    expect(hours(0.5)).toBe('30m');
    expect(hours(0.999)).toBe('1h');
    expect(hours(1.25)).toBe('1.3h');
    expect(hours(47.94)).toBe('47.9h');
    expect(hours(47.97)).toBe('2d');
    expect(hours(60)).toBe('2.5d');
  });
});
