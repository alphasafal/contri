import type { ClaimStatus } from './claims';
import type { LinkState } from './metrics';

export type Tone = 'good' | 'warn' | 'busy' | 'unknown';
export type Verdict = { tone: Tone; label: string; detail: string };

type LinkedPR = {
  number: number;
  state: string;
  author: string | null;
  repo?: string;
  /** Linked as closing the issue (Development panel or a closing keyword), not just mentioned. */
  closing?: boolean;
};

const refs = (prs: LinkedPR[]) => {
  const shown = prs.slice(0, 4).map((p) => `#${p.number}`);
  return prs.length > 4 ? `${shown.join(', ')} and ${prs.length - 4} more` : shown.join(', ');
};

/**
 * One honest headline for "can I work on this?", in priority order:
 * closed → open PR → assigned → active claim → quiet claim → merged PR (maybe fixed) →
 * incomplete check → looks free. A merged PR changes the headline only when it was linked
 * as closing the issue; mentions and PRs closed without merging are noted in the detail.
 */
export function verdict(input: {
  issueState: string;
  link: { state: LinkState; prs: LinkedPR[] };
  /** The issue's repository; references from other repositories are left out of the merged/closed notes. */
  repo?: string;
  claim: ClaimStatus;
  /** Which comments were checked for claims (from the insight report). */
  discussion?: { complete: boolean; inspected: number };
  /** Total comments on the issue. */
  comments?: number;
}): Verdict {
  const { issueState, link, claim, discussion, comments = 0, repo } = input;
  const own = link.prs.filter((p) => !repo || !p.repo || p.repo.toLowerCase() === repo.toLowerCase());
  const fixes = own.filter((p) => p.state === 'merged' && p.closing);
  const mentions = own.filter((p) => p.state === 'merged' && !p.closing);
  const abandoned = own.filter((p) => p.state === 'closed');
  const notes =
    (mentions.length
      ? ` ${mentions.length === 1 ? 'A merged pull request' : 'Merged pull requests'} (${refs(mentions)}) mention${mentions.length === 1 ? 's' : ''} it: check what is already done.`
      : '') +
    (abandoned.length
      ? ` ${abandoned.length === 1 ? 'An earlier pull request' : `${abandoned.length} earlier pull requests`} (${refs(abandoned)}) ${abandoned.length === 1 ? 'was' : 'were'} closed without merging: read why before trying again.`
      : '');
  const commentsComplete = discussion?.complete ?? true;
  if (issueState.toLowerCase() !== 'open') return { tone: 'busy', label: 'Closed', detail: 'This issue is closed.' };
  // A pull request in a fork or another repository that mentions this issue is a
  // detail, not the headline; only this repository's open PRs make it "busy".
  const open = own.find((p) => p.state === 'open');
  if (open)
    return {
      tone: 'busy',
      label: `Open PR #${open.number}`,
      detail: `${open.author ? `@${open.author} has` : 'There is'} an open pull request referencing this issue. Review it before starting.`,
    };
  if (claim.state === 'assigned')
    return { tone: 'busy', label: `Assigned to @${claim.assignees[0]}`, detail: claim.note };
  if (claim.state === 'claimed' && claim.claim)
    return { tone: 'warn', label: `Claimed by @${claim.claim.login}`, detail: claim.note };
  if (claim.state === 'stale') return { tone: 'warn', label: 'Claim went quiet', detail: claim.note };
  if (fixes.length)
    return {
      tone: 'warn',
      label: `Maybe fixed by #${fixes[0].number}`,
      detail: `Pull request ${refs(fixes)} was merged as a fix for this issue, but the issue is still open. Check whether anything is left to do before starting.`,
    };
  if (comments > 0 && discussion && discussion.inspected === 0)
    return {
      tone: 'unknown',
      label: 'Partly checked',
      detail: 'The comments could not be loaded, so claims were not checked. Read the thread before starting.',
    };
  if (link.state === 'incomplete')
    return {
      tone: 'unknown',
      label: 'Partly checked',
      detail: 'Some references could not be checked. Read the thread before starting.',
    };
  return {
    tone: 'good',
    label: 'Looks free',
    detail: `No assignee, no claim and no linked open pull request found.${
      commentsComplete ? '' : ' Only the latest comments were checked for claims.'
    }${notes} Say hello in the thread before you start.`,
  };
}
