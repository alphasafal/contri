/**
 * Pure evidence calculations. Everything here works on normalized data so the
 * REST (anonymous) and GraphQL (signed-in) paths produce identical numbers.
 */

export const DAY = 86_400_000;
export const WINDOW_DAYS = 90;

export type Actor = { login: string; bot: boolean } | null;

export type Reply = {
  author: Actor;
  association: string;
  at: string;
  url: string;
  kind: 'comment' | 'review';
  body?: string;
};

export type Thread = {
  kind: 'pr' | 'issue';
  number: number;
  title: string;
  url: string;
  createdAt: string;
  author: Actor;
  association: string;
  replies: Reply[];
  /** True when every reply was loaded (no pagination cap was hit). */
  complete: boolean;
};

export type Merge = { mergedAt: string; createdAt: string; author: Actor; url: string; mergedBy?: string | null };

export type Event = { at: string; url: string; kind: string; login: string; association?: string };

const TEAM_ASSOCIATIONS = new Set(['OWNER', 'MEMBER', 'COLLABORATOR']);
const OUTSIDE_ASSOCIATIONS = new Set(['NONE', 'FIRST_TIMER', 'FIRST_TIME_CONTRIBUTOR', 'CONTRIBUTOR']);

/** Normalizes a REST `user` object or a GraphQL `author` object. */
export function actor(value: { login?: string; type?: string; __typename?: string } | null | undefined): Actor {
  if (!value?.login) return null;
  const bot = value.type === 'Bot' || value.__typename === 'Bot' || /\[bot\]$/i.test(value.login);
  return { login: value.login, bot };
}

export const isHuman = (who: Actor): who is { login: string; bot: false } => Boolean(who && !who.bot);
export const isTeamAssociation = (association?: string | null) => TEAM_ASSOCIATIONS.has(association ?? '');
export const isOutsideAssociation = (association?: string | null) => OUTSIDE_ASSOCIATIONS.has(association ?? '');

export const since = (now = Date.now(), days = WINDOW_DAYS) => new Date(now - days * DAY).toISOString();

export type Week = { from: string; count: number };

export function activity(merges: Merge[], now: Date) {
  const start = now.getTime() - WINDOW_DAYS * DAY;
  const human = merges.filter((m) => {
    const at = Date.parse(m.mergedAt);
    return isHuman(m.author) && at >= start && at <= now.getTime();
  });
  const authors = new Set(human.map((m) => m.author!.login.toLowerCase()));
  // Buckets are counted back from now, so the newest four cover exactly 28 days
  // ("last four weeks") and the oldest holds the 90-day window's remainder.
  const weeks: Week[] = Array.from({ length: 13 }, (_, i) => {
    const to = i === 12 ? now.getTime() + 1 : now.getTime() - (12 - i) * 7 * DAY;
    const from = i === 0 ? start : now.getTime() - (13 - i) * 7 * DAY;
    return {
      from: new Date(from).toISOString(),
      count: human.filter((m) => {
        const at = Date.parse(m.mergedAt);
        return at >= from && at < to;
      }).length,
    };
  });
  return { merged: human.length, authors: authors.size, weeks, from: new Date(start).toISOString() };
}

/** Human merges in the last four weeks, or null when the merge sample could not be loaded. */
export function recentMerges(sample: { available: boolean; weeks: Week[] }): number | null {
  return sample.available ? sample.weeks.slice(-4).reduce((n, w) => n + w.count, 0) : null;
}

export type Timing = {
  sampled: number;
  answered: number;
  unanswered: number;
  averageHours: number | null;
  medianHours: number | null;
  sufficient: boolean;
};

/** Unanswered items are reported separately and never pull an average down or up. */
export function timing(values: Array<number | null>): Timing {
  const answered = values.filter((x): x is number => x !== null && Number.isFinite(x)).sort((a, b) => a - b);
  const n = answered.length;
  return {
    sampled: values.length,
    answered: n,
    unanswered: values.length - n,
    averageHours: n ? answered.reduce((a, b) => a + b, 0) / n : null,
    medianHours: n ? (answered[Math.floor((n - 1) / 2)] + answered[Math.floor(n / 2)]) / 2 : null,
    sufficient: n >= 3,
  };
}

export type TeamCheck = (login: string, association: string) => boolean;

/**
 * Hours from creation until the first human reply by the project team (never the
 * author, never a bot). `reply` is undefined when no qualifying reply was observed.
 */
export function firstTeamReply(thread: Thread, isTeam: TeamCheck): { hours: number | null; reply?: Reply } {
  const created = Date.parse(thread.createdAt);
  const author = thread.author?.login.toLowerCase();
  const first = thread.replies
    .filter((r) => {
      const at = Date.parse(r.at);
      return (
        isHuman(r.author) &&
        r.author.login.toLowerCase() !== author &&
        Number.isFinite(at) &&
        at >= created &&
        at <= Date.now() &&
        isTeam(r.author.login, r.association)
      );
    })
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at))[0];
  return first ? { hours: (Date.parse(first.at) - created) / 3_600_000, reply: first } : { hours: null };
}

export type LinkState = 'open' | 'clear' | 'incomplete';

export function linkState(prs: Array<{ state: string }>, complete: boolean): LinkState {
  if (prs.some((p) => p.state.toLowerCase() === 'open')) return 'open';
  return complete ? 'clear' : 'incomplete';
}

export function hasNextIssuePage(rawCount: number, total: number, page: number, perPage = 30) {
  return page < 10 && rawCount === perPage && page * perPage < total;
}

export const needsLinkCheck = (check: { state: string } | undefined) => !check || check.state === 'incomplete';

export function discussionSummary(replies: Reply[], complete: boolean, isTeam: TeamCheck) {
  const human = replies
    .filter((r) => isHuman(r.author) && Date.parse(r.at) <= Date.now())
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  const last = human[0];
  return {
    complete,
    inspected: replies.length,
    teamComments: human.filter((r) => isTeam(r.author!.login, r.association)).length,
    latest: last ? { at: last.at, url: last.url, login: last.author!.login, kind: 'comment' } : null,
  };
}

/** Ranks repositories for discovery: recent human merges first, then open beginner issues. */
export function discoveryScore(row: { merges90: number; goodFirstIssues: number; archived?: boolean }) {
  if (row.archived) return -1;
  return Math.min(row.merges90, 60) * 2 + Math.min(row.goodFirstIssues, 30);
}
