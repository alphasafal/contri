import { DAY, isHuman, type Reply, type TeamCheck } from './metrics';

/**
 * Detects "I'd like to work on this" style comments so contributors can see when an
 * issue is spoken for — and when a claim has gone quiet. This is a heuristic over
 * public comments; it never replaces asking in the thread.
 */

export type Claim = { login: string; at: string; url: string; text: string };

export type ClaimState = 'none' | 'assigned' | 'claimed' | 'stale';

/** A project-team member who said the work is theirs. `fresh` is false once it is older than the quiet limit. */
export type TeamClaim = { claim: Claim; ageDays: number; fresh: boolean };

export type ClaimStatus = {
  state: ClaimState;
  claim?: Claim;
  assignees: string[];
  ageDays?: number;
  /** Set when a maintainer said they are working on it and the team has not handed it back since. */
  team?: TeamClaim;
  note: string;
};

export const STALE_AFTER_DAYS = 21;

/*
 * A claim needs three things: a first-person intent ("I'd like to", "can I", "I'll"),
 * an action ("work on", "take", "fix") and a target ("this", "it", "the issue", "a PR").
 * The target is what keeps "+1" comments out: "I can confirm the fix works" and
 * "I'm hitting this too, please fix" have an intent word and the word "fix", but nobody
 * is offering to do anything.
 */

const INTENT = [
  String.raw`i(?:'?d| would)(?: really| also| still| definitely)? (?:like|love|be (?:happy|glad|willing|keen|able|interested))`,
  String.raw`i(?:'?m| am)(?: really| also| still| definitely)? (?:happy|glad|willing|keen|going|planning|trying|ready|interested|gonna|able)`,
  String.raw`i (?:want|wanna|wish|plan|intend|hope)`,
  String.raw`i(?:'?ll| will| shall| can| could)`,
  String.raw`let me`,
  String.raw`(?:can|could|may|might) i`,
  String.raw`(?:mind|ok|okay|alright|fine|cool) if i`,
  String.raw`(?:happy|glad|willing|would love|love) to`,
].join('|');

/** "I don't think I can fix this" and "not sure I can take it" are doubts, not offers. */
const DOUBT = String.raw`(?<!\b(?:do(?:n'?t| not) (?:think|believe)|not sure|unsure|doubt)\s+(?:that\s+|if\s+|whether\s+)?)`;

/**
 * Words allowed between the intent and the action ("I'd like to *try to* fix this").
 * A refusal, or a clause about somebody else ("let me know if *you* fix it",
 * "I'll *wait* for a *maintainer* to grab this"), ends the match.
 */
const GAP = String.raw`(?:(?!'t\b|n't\b|\b(?:not|never|unable|cannot|no longer|you|your|they|them|he|she|someone|somebody|anyone|anybody|nobody|who|whoever|how|if|whether|unless|until|wait|waiting|know|see|ask|wonder|expect|maintainers?|confirm|reproduce)\b)[^.?!\n]){0,40}?`;

const THING = String.raw`(?:issues?|bugs?|problem|task|ticket|feature|fix|part|one|typo|error|crash|docs?|documentation|tests?|work|piece|side|change|request|item)`;
/**
 * What is being taken: "this", "it", "the backend fix", "#123". "Take this opportunity",
 * "take that into account" and "fix this in my app" (a workaround) are not about the issue.
 */
const NOT_THE_ISSUE = String.raw`(?! (?:opportunity|chance|way|approach|workaround|offline|into|as|seriously|personally|locally|(?:in|on|for) (?:my|our) (?:own |local )?(?:app|project|code|codebase|repo|fork|setup|case|end|side|machine|env|environment|build))\b)`;
const TARGET = String.raw`(?:(?:this|it|that|these|those)\b${NOT_THE_ISSUE}|(?:the|a|an) (?:[\w-]+ ){0,2}${THING}\b|#\d+)`;

const VERB = String.raw`(?:work(?:ing)? on|contribut(?:e|ing) to|tak(?:e|ing)(?: up| on| over| care of)?|pick(?:ing)? up|grab(?:bing)?|claim(?:ing)?|handl(?:e|ing)|tackl(?:e|ing)|fix(?:ing)?|solv(?:e|ing)|resolv(?:e|ing)|address(?:ing)?|implement(?:ing)?|look(?:ing)? into|investigat(?:e|ing)|debug(?:ging)?|patch(?:ing)?|(?:get(?:ting)? )?start(?:ed|ing)? on)`;
const PR_NOUN = String.raw`(?:a|an|the|my) (?:[\w-]+ ){0,2}(?:prs?|pull requests?|merge requests?|patch|fix)\b`;
const SEND_PR = String.raw`(?:open(?:ing)?|submit(?:ting)?|send(?:ing)?|rais(?:e|ing)|creat(?:e|ing)|mak(?:e|ing)|put(?:ting)? up|fil(?:e|ing)|push(?:ing)?|prepar(?:e|ing)|draft(?:ing)?|writ(?:e|ing)|post(?:ing)?|contribut(?:e|ing)|provid(?:e|ing)) (?:up )?${PR_NOUN}`;

const ACTION = [
  `${VERB} ${TARGET}`,
  String.raw`pick(?:ing)? (?:this|it|that)(?: one)? up\b`,
  SEND_PR,
  String.raw`giv(?:e|ing) (?:this|it|that)(?: one)? a (?:try|shot|go|stab|crack|whirl)\b`,
  String.raw`(?:tak(?:e|ing)|hav(?:e|ing)) a (?:stab|shot|crack|swing|go|whack) at\b`,
  String.raw`(?:be|get) assigned\b`,
  String.raw`get (?:this|it|that) assigned\b`,
].join('|');

const WORKING_ON = String.raw`working on (?:this|it|that|a fix|the fix|a patch|a pr|the pr)\b`;
/** Things only someone already doing the work says: "I've started on this", "I opened a PR", "I have a fix". */
const UNDERWAY = [
  String.raw`\bi(?:'?m| am) on (?:it|this)\b`,
  String.raw`\bi(?:'ve| have)?(?: already| just)? (?:started|begun) (?:work(?:ing)? on|on|fixing|implementing|looking into) ${TARGET}`,
  String.raw`\bi(?:'ve| have)?(?: already| just)? (?:opened|submitted|created|pushed|sent|raised|made|put up|written|drafted|filed) ${PR_NOUN}`,
  String.raw`\bi(?:'ve| have|'ve got| have got| got) (?:a|an|my) (?:[\w-]+ ){0,2}(?:prs?|pull requests?|patch|fix|branch)\b`,
  String.raw`^\s*(?:just |already )?started (?:work(?:ing)? on|on) ${TARGET}`,
];

const CLAIM_PATTERNS = [
  new RegExp(String.raw`${DOUBT}\b(?:${INTENT})\b${GAP}\b(?:${ACTION})`, 'i'),
  /\b(?:please )?assign (?:this |it )?(?:issue )?(?:to )?me\b/i,
  /\bassign(?:ed)? to me\b/i,
  /^\s*\/(?:assign|take|claim)\b/im,
  // First person only: "@bob is already working on this" is news about Bob, not a claim.
  new RegExp(String.raw`(?:^|\b(?:i'?m|i am)\s+(?:already |currently |now |still )?)${WORKING_ON}`, 'im'),
  /^\s*on it\b/im,
  /(?:^\s*|\bi call(?:ing)? )dibs\b/im,
  ...UNDERWAY.map((p) => new RegExp(p, 'im')),
];

/**
 * A maintainer who writes "I can take a look" or "can I help?" is triaging, not taking the
 * issue. Only statements that the work is theirs or under way count for the project team:
 * "I'll fix this", "I'm working on it", "I have a PR for this".
 */
const TEAM_PATTERNS = [
  new RegExp(
    String.raw`${DOUBT}\bi(?:'?ll| will|'?m going to| am going to|'?m gonna)\b${GAP}\b(?:(?:fix|handle|tackle|take care of|take|pick up|implement|address|patch|work on|sort) ${TARGET}|${SEND_PR})`,
    'i',
  ),
  new RegExp(String.raw`(?:^|\b(?:i'?m|i am)\s+(?:already |currently |now |still )?)${WORKING_ON}`, 'im'),
  /^\s*on it\b/im,
  ...UNDERWAY.map((p) => new RegExp(p, 'im')),
];

/** The team handing an issue to the community cancels an earlier "I'll fix this" from the team. */
const TEAM_OPEN_PATTERNS = [
  /\b(?:prs?|pull requests?|contributions?|patches|a pr|a pull request|a patch) (?:(?:are|is|would be|very|most|always|more than) )*welcomed?\b/i,
  /\bup for grabs\b/i,
  /\bhelp (?:is )?wanted\b/i,
  /\bfeel free to\b/i,
  /\bhappy to (?:review|accept|merge|take a (?:pr|pull request|patch))\b/i,
  /\banyone (?:can|is welcome to|who wants to|interested)\b/i,
];

const RELEASE_PATTERNS = [
  /\b(?:no longer|not) (?:working|able to work) on\b/i,
  /\bunassign me\b/i,
  /\bfeel free to (?:take|pick|grab)\b/i,
  // "can't finish it" gives the issue back; "can't finish this week" or "today" is a delay.
  /\b(?:won'?t|can'?t|cannot|unable to|not going to) (?:be able to )?(?:(?:work on|finish|fix|take) (?:this|it)\b(?! ?(?:week|month|year|today|tonight|tomorrow|weekend|sprint|morning|afternoon|evening|until|before|by |right now|now\b))|continue(?: (?:with )?(?:this|it))?(?=[\s,.!]*$|[.,!]))/im,
  /\b(?:don'?t|do not|won'?t|will not|no longer) have (?:the |enough )?(?:time|bandwidth|capacity)\b/i,
  /\bsomeone else (?:can|could|should|may|is welcome to) (?:take|pick|grab|have|work on)\b/i,
  /\b(?:i'?m|i am) (?:dropping|abandoning|giving up on|stepping (?:away|back) from) (?:this|it)\b/i,
];

/**
 * "Is anyone working on this?" is a question, not a claim, but what follows it often
 * is ("if not, I'd like to take it"). The question is dropped and the rest is judged.
 */
const QUESTION_ABOUT_OTHERS =
  /^[^.?!\n]*\b(?:is |has )?(?:anyone|someone|somebody|anybody)\b[^.?!\n]*\bworking on\b[^.?!\n]*[?.!]?/gim;

export function isClaimText(text: string): boolean {
  const body = stripQuotes(text).replace(QUESTION_ABOUT_OTHERS, ' ');
  return CLAIM_PATTERNS.some((p) => p.test(body));
}

export const isReleaseText = (text: string) => RELEASE_PATTERNS.some((p) => p.test(stripQuotes(text)));

/** A project-team statement that the work is theirs or already under way. */
export const isTeamClaimText = (text: string) => {
  const body = stripQuotes(text).replace(QUESTION_ABOUT_OTHERS, ' ');
  return TEAM_PATTERNS.some((p) => p.test(body));
};

/** The project team inviting others to take the issue ("PRs welcome", "feel free to pick this up"). */
export const isTeamOpenText = (text: string) => {
  const body = stripQuotes(text);
  return TEAM_OPEN_PATTERNS.some((p) => p.test(body)) || RELEASE_PATTERNS.some((p) => p.test(body));
};

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
    if (isClaimText(c.body)) {
      claims.push({ login, at: c.at, url: c.url, text: summarize(c.body) });
    } else if (isReleaseText(c.body)) {
      released.set(login.toLowerCase(), Date.parse(c.at));
    }
  }
  return claims.filter((claim) => {
    const releasedAt = released.get(claim.login.toLowerCase());
    return releasedAt === undefined || releasedAt < Date.parse(claim.at);
  });
}

/**
 * The latest "I'll fix this" / "I'm working on it" from the project team, unless someone on
 * the team later opened the issue to contributors ("PRs welcome"). Outside contributors'
 * offers are handled by `detectClaims`.
 */
export function detectTeamClaim(comments: Reply[], isTeam: TeamCheck, now = Date.now()): TeamClaim | undefined {
  let found: Claim | undefined;
  const ordered = [...comments].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  for (const c of ordered) {
    if (!isHuman(c.author) || !c.body || !isTeam(c.author.login, c.association)) continue;
    if (isTeamClaimText(c.body)) found = { login: c.author.login, at: c.at, url: c.url, text: summarize(c.body) };
    else if (isTeamOpenText(c.body)) found = undefined;
  }
  if (!found) return undefined;
  const claimant = found.login.toLowerCase();
  const lastActivity = Math.max(
    Date.parse(found.at),
    ...comments
      .filter((c) => c.author?.login.toLowerCase() === claimant)
      .map((c) => Date.parse(c.at))
      .filter(Number.isFinite),
  );
  const ageDays = Math.max(0, Math.floor((now - lastActivity) / DAY));
  return { claim: found, ageDays, fresh: ageDays <= STALE_AFTER_DAYS };
}

const ago = (days: number) => (days === 0 ? 'today' : `${days} day${days === 1 ? '' : 's'} ago`);

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
  const team = detectTeamClaim(input.comments, input.isTeam, now);
  const teamNote = team
    ? ` @${team.claim.login} from the project team said they are working on it ${ago(team.ageDays)}.`
    : '';
  if (!claim)
    return {
      state: 'none',
      assignees,
      ...(team ? { team } : {}),
      note: team ? `No claim from outside contributors.${teamNote}` : 'No public claim found in the comments.',
    };
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
  const shared = { claim, assignees, ageDays, ...(team ? { team } : {}) };
  if (prAuthors.has(claimant))
    return { state: 'claimed', ...shared, note: `@${claim.login} has an open pull request for this.` };
  if (ageDays > STALE_AFTER_DAYS)
    return {
      state: 'stale',
      ...shared,
      note: `@${claim.login} offered to work on this ${ageDays} days ago with no linked pull request since. It may be free — ask politely in the thread first.${teamNote}`,
    };
  return {
    state: 'claimed',
    ...shared,
    note: `@${claim.login} offered to work on this ${ago(ageDays)}.`,
  };
}
