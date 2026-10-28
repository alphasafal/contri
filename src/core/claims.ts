import { DAY, isHuman, type Reply, type TeamCheck } from './metrics';

/**
 * Detects "I'd like to work on this" style comments so contributors can see when an
 * issue is spoken for — and when a claim has gone quiet. This is a heuristic over
 * public comments; it never replaces asking in the thread.
 */

export type Claim = { login: string; at: string; url: string; text: string };

export type ClaimState = 'none' | 'assigned' | 'claimed' | 'stale';

export type ClaimStatus = {
  state: ClaimState;
  claim?: Claim;
  assignees: string[];
  ageDays?: number;
  note: string;
};

export const STALE_AFTER_DAYS = 21;

const CLAIM_PATTERNS = [
  /\b(?:i'?d|i would|i'?m|i am|i will|i'?ll|i want to|i wanna|i can|let me|can i|could i|may i)\b(?:(?!'t\b|\b(?:not|never|unable|cannot)\b|\bno longer\b)[^.?!\n]){0,40}?\b(?:work(?:ing)? on|take|pick(?:ing)? (?:this|it) up|pick up|handle|tackle|fix|grab|claim|look into|give (?:this|it) a (?:try|shot|go))\b/i,
  /\b(?:please )?assign (?:this |it )?(?:issue )?(?:to )?me\b/i,
  /\bassign(?:ed)? to me\b/i,
  /^\s*\/(?:assign|take|claim)\b/im,
  /(?:^|\b(?:i'?m|i am|already|currently)\s+)working on (?:this|it|a fix|a pr|the fix)\b/im,
];

const RELEASE_PATTERNS = [
  /\b(?:no longer|not) (?:working|able to work) on\b/i,
  /\bunassign me\b/i,
  /\bfeel free to (?:take|pick|grab)\b/i,
  /\b(?:won'?t|can'?t|cannot|unable to|not going to) (?:be able to )?(?:work on|finish|continue|(?:fix|take) (?:this|it)\b)/i,
];

const NOT_A_CLAIM = [/\btake a look\b/i, /\bis (?:anyone|someone|somebody) working on\b/i];

export function isClaimText(text: string): boolean {
  const body = stripQuotes(text);
  if (NOT_A_CLAIM.some((p) => p.test(body))) return CLAIM_PATTERNS.slice(1, 4).some((p) => p.test(body));
  return CLAIM_PATTERNS.some((p) => p.test(body));
}

export const isReleaseText = (text: string) => RELEASE_PATTERNS.some((p) => p.test(stripQuotes(text)));

/**
 * Ignores quoted replies (`> ...`), code blocks and text GitHub does not show \u2014
 * HTML comments and collapsed `<details>` \u2014 so we judge only what the person
 * visibly wrote and a hidden "I'll take this" cannot fake a claim.
 * Curly apostrophes (smart quotes on phones and macOS) are treated as straight ones.
 */
function stripQuotes(text: string) {
  return text
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/<!--[\s\S]*?(?:-->|$)/g, ' ')
    .replace(/<details\b[\s\S]*?(?:<\/details\s*>|$)/gi, ' ')
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('>'))
    .join('\n');
}

export function detectClaims(comments: Reply[], isTeam: TeamCheck): Claim[] {
  const released = new Map<string, number>();
  const claims: Claim[] = [];
  const ordered = [...comments].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  for (const c of ordered) {
    if (!isHuman(c.author) || !c.body || isTeam(c.author.login, c.association)) continue;
    const login = c.author.login;
    if (isReleaseText(c.body)) {
      released.set(login.toLowerCase(), Date.parse(c.at));
      continue;
    }
    if (isClaimText(c.body)) claims.push({ login, at: c.at, url: c.url, text: summarize(c.body) });
  }
  return claims.filter((claim) => {
    const releasedAt = released.get(claim.login.toLowerCase());
    return releasedAt === undefined || releasedAt < Date.parse(claim.at);
  });
}

function summarize(body: string) {
  const line = stripQuotes(body).replace(/\s+/g, ' ').trim();
  return line.length > 140 ? `${line.slice(0, 137)}…` : line;
}

export function claimStatus(input: {
  comments: Reply[];
  isTeam: TeamCheck;
  assignees: string[];
  /** Authors of open pull requests that reference the issue. */
  openPrAuthors: string[];
  now?: number;
}): ClaimStatus {
  const now = input.now ?? Date.now();
  const { assignees } = input;
  if (assignees.length)
    return {
      state: 'assigned',
      assignees,
      note: `Assigned to ${assignees.map((a) => `@${a}`).join(', ')}. Ask in the thread before starting.`,
    };
  const claims = detectClaims(input.comments, input.isTeam);
  const claim = claims.at(-1);
  if (!claim) return { state: 'none', assignees, note: 'No public claim found in the comments.' };
  const claimant = claim.login.toLowerCase();
  const prAuthors = new Set(input.openPrAuthors.map((a) => a.toLowerCase()));
  const lastActivity = Math.max(
    Date.parse(claim.at),
    ...input.comments
      .filter((c) => c.author?.login.toLowerCase() === claimant)
      .map((c) => Date.parse(c.at))
      .filter(Number.isFinite),
  );
  const ageDays = Math.floor((now - lastActivity) / DAY);
  if (prAuthors.has(claimant))
    return { state: 'claimed', claim, assignees, ageDays, note: `@${claim.login} has an open pull request for this.` };
  if (ageDays > STALE_AFTER_DAYS)
    return {
      state: 'stale',
      claim,
      assignees,
      ageDays,
      note: `@${claim.login} offered to work on this ${ageDays} days ago with no linked pull request since. It may be free — ask politely in the thread first.`,
    };
  return {
    state: 'claimed',
    claim,
    assignees,
    ageDays,
    note: `@${claim.login} offered to work on this ${ageDays === 0 ? 'today' : `${ageDays} day${ageDays === 1 ? '' : 's'} ago`}.`,
  };
}
