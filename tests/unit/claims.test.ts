import { describe, expect, it } from 'vitest';
import { claimStatus, detectClaims, isClaimText, isReleaseText } from '../../src/core/claims';
import { verdict } from '../../src/core/verdict';
import type { Reply } from '../../src/core/metrics';
import { isoAgo } from './helpers';

const isTeam = (_: string, association: string) => ['OWNER', 'MEMBER', 'COLLABORATOR'].includes(association);
const comment = (login: string, body: string, days: number, association = 'NONE'): Reply => ({
  author: { login, bot: false },
  association,
  at: isoAgo(days),
  url: `https://github.com/a/b/issues/1#${login}-${days}`,
  kind: 'comment',
  body,
});

describe('claim text', () => {
  it.each([
    "Hi! I'd like to work on this.",
    'Can I take this issue?',
    'Please assign this to me',
    '/assign',
    "I'm working on a fix now",
    'Working on it!',
    'I will pick this up tomorrow',
    'Could I give it a try?',
    "I'll look into it this weekend",
    'I\u2019d like to work on this',
    "I'm not sure about the API, but I'd like to work on this",
  ])('recognizes a claim: %s', (text) => expect(isClaimText(text)).toBe(true));

  it.each([
    'Is anyone working on this?',
    'I will take a look at the logs later',
    'Thanks for the report!',
    '> I would like to work on this\nSame bug here on Windows.',
    '```\nI will fix this\n```',
    "I can't take this one, sorry",
    'I can\u2019t take this one, sorry',
    "I'm not going to work on this anymore",
    'I will not take this',
    "I'm unable to work on this",
    'I would never fix it this way',
    "Same here.\n<!-- I'd like to work on this -->",
    "Same here.\n<details><summary>logs</summary>\nI'll take this\n</details>",
    '<details>\n/assign',
  ])('does not treat as a claim: %s', (text) => expect(isClaimText(text)).toBe(false));

  it('ignores a release hidden in an HTML comment but reads the visible text', () => {
    expect(isReleaseText('<!-- feel free to take it --> Still on it')).toBe(false);
    expect(isClaimText('<!-- not a claim -->\nI would like to work on this')).toBe(true);
  });

  it('recognizes when someone gives an issue back', () => {
    expect(isReleaseText("Sorry, I'm no longer working on this")).toBe(true);
    expect(isReleaseText('Feel free to take it!')).toBe(true);
    expect(isReleaseText("I won't be able to fix this, sorry")).toBe(true);
    expect(isReleaseText("I'm not going to work on this anymore")).toBe(true);
    expect(isReleaseText('I\u2019m unable to work on this')).toBe(true);
    expect(isReleaseText('Still on it')).toBe(false);
  });
});

describe('claim status', () => {
  it('ignores maintainers offering help and released claims', () => {
    const claims = detectClaims(
      [
        comment('maint', "I'll fix this", 9, 'MEMBER'),
        comment('alex', "I'd like to work on this", 8),
        comment('alex', "Sorry, I can't finish this", 6),
      ],
      isTeam,
    );
    expect(claims).toEqual([]);
  });

  it('reports a fresh claim', () => {
    const status = claimStatus({
      comments: [comment('sam', 'Can I work on this?', 3)],
      isTeam,
      assignees: [],
      openPrAuthors: [],
    });
    expect(status.state).toBe('claimed');
    expect(status.claim?.login).toBe('sam');
    expect(status.note).toMatch(/3 days ago/);
  });

  it('marks a quiet claim as stale and counts later comments by the claimant as activity', () => {
    const quiet = claimStatus({
      comments: [comment('sam', 'Can I work on this?', 40)],
      isTeam,
      assignees: [],
      openPrAuthors: [],
    });
    expect(quiet.state).toBe('stale');
    const active = claimStatus({
      comments: [comment('sam', 'Can I work on this?', 40), comment('sam', 'Progress: tests pass locally', 2)],
      isTeam,
      assignees: [],
      openPrAuthors: [],
    });
    expect(active.state).toBe('claimed');
  });

  it('keeps an old claim active when the claimant has an open PR', () => {
    const status = claimStatus({
      comments: [comment('sam', '/take', 60)],
      isTeam,
      assignees: [],
      openPrAuthors: ['Sam'],
    });
    expect(status.state).toBe('claimed');
    expect(status.note).toMatch(/open pull request/);
  });

  it('puts assignment first', () => {
    const status = claimStatus({
      comments: [comment('sam', '/take', 1)],
      isTeam,
      assignees: ['kim'],
      openPrAuthors: [],
    });
    expect(status.state).toBe('assigned');
  });
});

describe('verdict', () => {
  const none = claimStatus({ comments: [], isTeam, assignees: [], openPrAuthors: [] });
  it('prioritizes closed, open PR, assignment, claim, then free', () => {
    expect(verdict({ issueState: 'closed', link: { state: 'clear', prs: [] }, claim: none }).label).toBe('Closed');
    expect(
      verdict({
        issueState: 'open',
        link: { state: 'open', prs: [{ number: 9, state: 'open', author: 'x' }] },
        claim: none,
      }).label,
    ).toBe('Open PR #9');
    expect(verdict({ issueState: 'open', link: { state: 'incomplete', prs: [] }, claim: none }).tone).toBe('unknown');
    const free = verdict({ issueState: 'OPEN', link: { state: 'clear', prs: [] }, claim: none });
    expect(free).toMatchObject({ tone: 'good', label: 'Looks free' });
    expect(free.detail).not.toMatch(/latest comments/);
  });
  it('says when only part of a long discussion was checked for claims', () => {
    const partial = verdict({
      issueState: 'open',
      link: { state: 'clear', prs: [] },
      claim: none,
      discussion: { complete: false, inspected: 100 },
      comments: 250,
    });
    expect(partial.label).toBe('Looks free');
    expect(partial.detail).toMatch(/Only the latest comments were checked for claims/);
  });
  it('is not green when no comment could be checked at all', () => {
    const unchecked = verdict({
      issueState: 'open',
      link: { state: 'clear', prs: [] },
      claim: none,
      discussion: { complete: false, inspected: 0 },
      comments: 12,
    });
    expect(unchecked).toMatchObject({ tone: 'unknown', label: 'Partly checked' });
    expect(unchecked.detail).toMatch(/comments could not be loaded/);
    const quiet = verdict({
      issueState: 'open',
      link: { state: 'clear', prs: [] },
      claim: none,
      discussion: { complete: true, inspected: 0 },
      comments: 0,
    });
    expect(quiet.label).toBe('Looks free');
  });
  it('notes pull requests that were closed without merging, without changing the headline', () => {
    const v = verdict({
      repo: 'acme/widgets',
      issueState: 'open',
      link: {
        state: 'clear',
        prs: [
          ...[1, 2, 3, 4, 5, 6].map((n) => ({ number: n, state: 'closed', author: `a${n}`, repo: 'acme/widgets' })),
          { number: 99, state: 'closed', author: 'b', repo: 'other/project' },
        ],
      },
      claim: none,
    });
    expect(v).toMatchObject({ tone: 'good', label: 'Looks free' });
    expect(v.detail).toMatch(/6 earlier pull requests \(#1, #2, #3, #4 and 2 more\) were closed without merging/);
    expect(v.detail).not.toMatch(/#99/);
    const one = verdict({
      issueState: 'open',
      link: { state: 'clear', prs: [{ number: 7, state: 'closed', author: 'a' }] },
      claim: none,
    });
    expect(one.detail).toMatch(/An earlier pull request \(#7\) was closed without merging/);
  });
  it('says an open issue may be fixed only when a merged PR was linked as closing it', () => {
    const fixed = verdict({
      issueState: 'open',
      link: { state: 'clear', prs: [{ number: 12, state: 'merged', author: 'a', closing: true }] },
      claim: none,
    });
    expect(fixed).toMatchObject({ tone: 'warn', label: 'Maybe fixed by #12' });
    const mentioned = verdict({
      issueState: 'open',
      link: { state: 'clear', prs: [{ number: 13, state: 'merged', author: 'a', closing: false }] },
      claim: none,
    });
    expect(mentioned).toMatchObject({ tone: 'good', label: 'Looks free' });
    expect(mentioned.detail).toMatch(/A merged pull request \(#13\) mentions it/);
    const claimed = verdict({
      issueState: 'open',
      link: { state: 'clear', prs: [{ number: 12, state: 'merged', author: 'a', closing: true }] },
      claim: { ...none, state: 'assigned', assignees: ['sam'], note: 'Assigned.' },
    });
    expect(claimed.label).toBe('Assigned to @sam');
  });
});
