import type { InsightReport } from '../../src/background/reports/insight';
import { STALE_AFTER_DAYS } from '../../src/core/claims';

/**
 * What the action says, decided from the same issue report the extension shows.
 * Pure functions: no network, no environment. `index.ts` does the reading and posting.
 */

export const DUPLICATE_MARKER = '<!-- contri:duplicate-work -->';
export const nudgeMarker = (login: string) => `<!-- contri:quiet-claim @${login.toLowerCase()} -->`;

const FOOTER =
  '<sub>Posted automatically by [CONTRI](https://github.com/alphasafal/contri) from public comments, assignees and linked pull requests. It can be wrong: the thread has the last word.</sub>';

const same = (a: string | null | undefined, b: string | null | undefined) =>
  Boolean(a && b && a.toLowerCase() === b.toLowerCase());
const ago = (days: number) => (days <= 0 ? 'today' : `${days} day${days === 1 ? '' : 's'} ago`);

export type Finding = {
  issue: number;
  kind: 'open-pr' | 'assigned' | 'claimed' | 'team';
  /** One sentence for the comment, with links. */
  text: string;
};

/**
 * Is someone else already on this issue? Other people's open pull requests come first,
 * then an assignee, then a recent "I'd like to work on this", then a maintainer who said
 * the work is theirs. The pull request's own author never counts against it, and a claim
 * that went quiet is not a reason to stop anyone.
 */
export function duplicateWork(report: InsightReport, pr: { number: number; author: string }, repo: string): Finding[] {
  const issue = report.issue.number;
  if (report.issue.state.toLowerCase() !== 'open') return [];
  const others = report.link.prs.filter(
    (p) => p.state === 'open' && same(p.repo, repo) && p.number !== pr.number && !same(p.author, pr.author),
  );
  if (others.length) {
    const first = others[0];
    return [
      {
        issue,
        kind: 'open-pr',
        text: `#${issue} already has an open pull request: #${first.number}${first.author ? ` by @${first.author}` : ''}${
          others.length > 1 ? ` (and ${others.length - 1} more)` : ''
        }.`,
      },
    ];
  }
  const assignees = report.issue.assignees;
  if (assignees.length && !assignees.some((a) => same(a, pr.author)))
    return [{ issue, kind: 'assigned', text: `#${issue} is assigned to ${assignees.map((a) => `@${a}`).join(', ')}.` }];
  const { claim } = report;
  if (claim.state === 'claimed' && claim.claim && !same(claim.claim.login, pr.author))
    return [
      {
        issue,
        kind: 'claimed',
        text: `@${claim.claim.login} [offered to work on #${issue}](${claim.claim.url}) ${ago(claim.ageDays ?? 0)}.`,
      },
    ];
  if (claim.team?.fresh && !same(claim.team.claim.login, pr.author))
    return [
      {
        issue,
        kind: 'team',
        text: `@${claim.team.claim.login} from the project team [said they are working on #${issue}](${claim.team.claim.url}) ${ago(claim.team.ageDays)}.`,
      },
    ];
  return [];
}

/** The comment for a pull request whose issue looks taken. Friendly: the author may simply not have seen it. */
export function duplicateComment(author: string, findings: Finding[]): string {
  return [
    DUPLICATE_MARKER,
    `Thanks for the pull request, @${author}! A heads-up before anyone spends more time on it:`,
    '',
    ...findings.map((f) => `- ${f.text}`),
    '',
    'This may be fine — plans change and work gets handed over. If you have not already, a quick note in the issue to coordinate saves everyone a duplicate review.',
    '',
    FOOTER,
  ].join('\n');
}

export type Nudge = { issue: number; login: string; ageDays: number; claimUrl: string };

/**
 * A claim that went quiet: someone offered to work on an unassigned issue, at least
 * `staleDays` ago (never fewer than the extension's own limit), with no open pull request
 * and nothing from them since.
 */
export function quietClaim(report: InsightReport, staleDays: number): Nudge | null {
  const { claim, issue } = report;
  if (issue.state.toLowerCase() !== 'open' || claim.state !== 'stale' || !claim.claim) return null;
  const age = claim.ageDays ?? 0;
  if (age < Math.max(staleDays, STALE_AFTER_DAYS + 1)) return null;
  return { issue: issue.number, login: claim.claim.login, ageDays: age, claimUrl: claim.claim.url };
}

export function nudgeComment(nudge: Nudge): string {
  return [
    nudgeMarker(nudge.login),
    `@${nudge.login}, are you still working on this? You [offered](${nudge.claimUrl}) ${ago(nudge.ageDays)} and there is no linked pull request yet.`,
    '',
    'No pressure either way. If you have moved on, just say so and someone else can pick it up; if you are stuck, this is a good place to ask.',
    '',
    FOOTER,
  ].join('\n');
}

const CLOSING = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\b\s*:?\s+(?:([\w.-]+\/[\w.-]+))?#(\d{1,9})\b/gi;

/** Issue numbers a pull request says it closes ("Fixes #12"), in this repository only. */
export function closingNumbers(text: string, repo: string): number[] {
  const found = new Set<number>();
  for (const m of text.matchAll(CLOSING)) {
    if (m[1] && m[1].toLowerCase() !== repo.toLowerCase()) continue;
    const n = Number(m[2]);
    if (n > 0) found.add(n);
  }
  return [...found];
}
