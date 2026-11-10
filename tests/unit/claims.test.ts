import { describe, expect, it } from 'vitest';
import {
  claimStatus,
  detectClaims,
  detectTeamClaim,
  isClaimText,
  isReleaseText,
  isTeamClaimText,
} from '../../src/core/claims';
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
    "Is anyone working on this? If not, I'd like to take it.",
    'is someone already working on this? if not I would like to work on it',
    "I'm currently working on this",
    "I'm no longer working on the UI part, but I'll take the backend fix",
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
    '@bob is already working on this, see #45',
    'Someone is currently working on this',
    'Is anyone working on this? Thanks',
    'I want to take this opportunity to say thanks',
    'I will look into whether this is a duplicate',
    "Same here.\n<!-- I'd like to work on this -->",
    "Same here.\n<details><summary>logs</summary>\nI'll take this\n</details>",
    '<details>\n/assign',
  ])('does not treat as a claim: %s', (text) => expect(isClaimText(text)).toBe(false));

  // "+1" comments have a first-person word and the word "fix", but nobody offers to do anything.
  it.each([
    'I can confirm the fix works on 2.3.1',
    "I'm seeing the same issue, any fix yet",
    'I can reproduce this, a fix would be great',
    'I am also affected, is there a fix',
    "I'd love to see a fix for this",
    "I'm using v3 and the workaround didn't fix it",
    'I can take screenshots if that helps',
    'I will take your word for it',
    'Could I get some guidance on how you handle this in v2',
    "I'm happy that someone will fix this",
    'I am not sure how to fix this',
    "I'm hitting this too, please fix",
    'I am waiting for someone to pick up this issue',
    'I would expect the parser to handle empty input',
    "I'm wondering who will take this",
    'Can I ask why this was closed',
    'I can see how to work on other things until then',
    'Let me know if you fix it',
    "I'll wait for a maintainer to grab this",
    "I don't think I can fix this",
    'Not sure I can take this on right now',
    'I would like this fixed before the next release',
    'I hope you can fix this soon',
    'I wish someone would fix this',
    'Could I get help with this error?',
    'I will take a look at the issue tomorrow',
    'I can take this offline',
    'Thanks, I will take that into account',
    'I can fix this locally by deleting node_modules',
    'I can address this in my app by retrying',
    "I'll try this workaround and report back",
    'I can help test a fix',
  ])('does not read a "+1" or a question as a claim: %s', (text) => expect(isClaimText(text)).toBe(false));

  it.each([
    'I would like to contribute to this issue',
    "I'll open a PR for this tonight",
    "I'll send a patch",
    'Mind if I take a stab at this?',
    'I have a PR almost ready',
    "I'm on it",
    'On it.',
    'I want to solve this issue',
    'Can I contribute to this?',
    "I'd like to implement this",
    "I'll submit a PR",
    'I can fix this',
    'I think I can fix this over the weekend',
    'Happy to take this one',
    "I'm interested in working on this",
    "I've started working on this",
    'I opened a draft PR for this',
    'Can I get this assigned?',
    'Can I be assigned?',
    "I'd like to try to fix this",
    'I would love to pick this up',
    "I'm going to tackle this",
    "I'll see if I can work on this tonight",
    'Could I take a crack at it?',
    "I'll take #42",
    'dibs!',
    "I'd be happy to contribute a fix",
    'Started working on this',
    "I'd like to work on this in my free time",
  ])('recognizes more ways of taking an issue: %s', (text) => expect(isClaimText(text)).toBe(true));

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
    // A delay is not giving the issue back.
    expect(isReleaseText("I can't finish this week, will continue next week")).toBe(false);
    expect(isReleaseText('I cannot work on this today')).toBe(false);
    expect(isReleaseText("I can't finish it.")).toBe(true);
    expect(isReleaseText("I won't be able to continue with this.")).toBe(true);
  });

  it('recognizes more ways of giving an issue back', () => {
    expect(isReleaseText("Sorry, I don't have time for this anymore")).toBe(true);
    expect(isReleaseText('Someone else can take this')).toBe(true);
    expect(isReleaseText("I'm dropping this, too busy")).toBe(true);
  });

  it('a comment that gives back one part and takes another counts as a claim', () => {
    const comments: Reply[] = [
      {
        author: { login: 'kim', bot: false },
        association: 'NONE',
        at: isoAgo(2),
        url: 'c1',
        kind: 'comment',
        body: "I'm no longer working on the UI part, but I'll take the backend fix",
      },
    ];
    expect(detectClaims(comments, () => false).map((c) => c.login)).toEqual(['kim']);
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

  it('a maintainer who says the work is theirs is reported separately from outside claims', () => {
    const now = Date.now();
    const fresh = detectTeamClaim([comment('maint', "I'll fix this in the next release", 4, 'MEMBER')], isTeam, now);
    expect(fresh).toMatchObject({ claim: { login: 'maint' }, ageDays: 4, fresh: true });
    // Triage is not taking the issue.
    expect(isTeamClaimText('I can take a look')).toBe(false);
    expect(isTeamClaimText('Can I help with this?')).toBe(false);
    expect(isTeamClaimText('Happy to review a PR that fixes this')).toBe(false);
    expect(isTeamClaimText("I'm working on a fix")).toBe(true);
    expect(isTeamClaimText('I have a PR for this, will push tonight')).toBe(true);
    // Outside contributors are not "the team".
    expect(detectTeamClaim([comment('alex', "I'll fix this", 2)], isTeam, now)).toBeUndefined();
    // The team handing it to contributors cancels it; an old statement is no longer fresh.
    expect(
      detectTeamClaim(
        [
          comment('maint', "I'll fix this", 9, 'MEMBER'),
          comment('lead', 'No time after all, PRs welcome!', 3, 'OWNER'),
        ],
        isTeam,
        now,
      ),
    ).toBeUndefined();
    expect(detectTeamClaim([comment('maint', "I'm working on it", 60, 'MEMBER')], isTeam, now)?.fresh).toBe(false);
  });

  it('a fresh maintainer statement is the headline; a quiet one is a note on "Looks free"', () => {
    const link = { state: 'clear' as const, prs: [] };
    const fresh = claimStatus({
      comments: [comment('maint', "I'm working on a fix", 2, 'MEMBER')],
      isTeam,
      assignees: [],
      openPrAuthors: [],
    });
    expect(fresh.state).toBe('none');
    expect(fresh.note).toMatch(/@maint from the project team/);
    expect(verdict({ issueState: 'open', link, claim: fresh })).toMatchObject({
      tone: 'warn',
      label: 'Maintainer @maint is on it',
    });
    const quiet = claimStatus({
      comments: [comment('maint', "I'm working on a fix", 90, 'MEMBER')],
      isTeam,
      assignees: [],
      openPrAuthors: [],
    });
    const v = verdict({ issueState: 'open', link, claim: quiet });
    expect(v).toMatchObject({ tone: 'good', label: 'Looks free' });
    expect(v.detail).toMatch(/@maint from the project team said they would work on it 90 days ago/);
    // An outside contributor's active claim still comes first.
    const both = claimStatus({
      comments: [comment('maint', "I'll fix this", 5, 'MEMBER'), comment('sam', 'Can I take this?', 1)],
      isTeam,
      assignees: [],
      openPrAuthors: [],
    });
    expect(verdict({ issueState: 'open', link, claim: both }).label).toBe('Claimed by @sam');
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
  it('an open pull request in another repository does not make the issue busy', () => {
    const result = verdict({
      issueState: 'open',
      repo: 'acme/widgets',
      link: { state: 'open', prs: [{ number: 4, state: 'open', author: 'x', repo: 'fork/widgets' }] },
      claim: none,
    });
    expect(result.tone).toBe('good');
    expect(result.label).toBe('Looks free');
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
