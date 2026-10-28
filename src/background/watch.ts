import type { InsightReport } from './reports/insight';
import type { WatchSnapshot, Watched } from '../shared/protocol';
import { parseRepo } from '../shared/repo';

export const WATCH_ALARM = 'contri-watch';
export const WATCH_LIMIT = { signedIn: 10, anonymous: 3 };

const sameRepo = (prRepo: string | undefined, issueUrl: string) => {
  const repo = parseRepo(issueUrl);
  return !repo || !prRepo || prRepo.toLowerCase() === repo.toLowerCase();
};

export function snapshotOf(report: InsightReport): WatchSnapshot {
  return {
    state: report.issue.state,
    assignees: report.issue.assignees,
    // Same scope as the verdict: open PRs in this repository, not in forks that mention it.
    openPrs: report.link.prs.filter((p) => p.state === 'open' && sameRepo(p.repo, report.issue.url)).length,
    claim: report.claim.state,
  };
}

/** Plain-language description of what changed for a watched issue, or null when nothing useful did. */
export function describeChange(before: WatchSnapshot | undefined, after: WatchSnapshot): string | null {
  if (!before) return null;
  if (before.state === 'open' && after.state !== 'open') return 'The issue was closed.';
  if (before.assignees.length && !after.assignees.length && after.state === 'open')
    return 'The issue is unassigned again — it may be free to pick up.';
  if (!before.openPrs && after.openPrs) return 'Someone opened a pull request for this issue.';
  if (before.openPrs && !after.openPrs && after.state === 'open')
    return 'The linked pull request was closed — the issue may be free again.';
  if (before.claim === 'claimed' && after.claim === 'stale') return 'The claim on this issue has gone quiet.';
  if (!before.assignees.length && after.assignees.length)
    return `Assigned to ${after.assignees.map((a) => `@${a}`).join(', ')}.`;
  return null;
}

export function addWatched(
  list: Watched[],
  item: { repo: string; number: number; title: string },
  limit: number,
): Watched[] {
  const url = `https://github.com/${item.repo}/issues/${item.number}`;
  if (list.some((w) => w.url === url)) return list;
  if (list.length >= limit)
    throw new Error(
      limit === WATCH_LIMIT.anonymous
        ? `Anonymous mode can watch ${limit} issues. Sign in to watch up to ${WATCH_LIMIT.signedIn}.`
        : `You can watch up to ${limit} issues. Remove one first.`,
    );
  return [{ ...item, title: item.title.slice(0, 250), url, addedAt: new Date().toISOString() }, ...list];
}
