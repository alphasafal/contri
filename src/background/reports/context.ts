import { GitHubClient, GitHubError } from '../github';
import { actor, type Reply } from '../../core/metrics';

export type Ctx = {
  client: GitHubClient;
  /** Signed in: GraphQL paths are available and capacity is ~5,000 requests/hour. */
  authed: boolean;
  signal?: AbortSignal;
  now: Date;
};

export function createCtx(authed: boolean, signal?: AbortSignal): Ctx {
  return { client: new GitHubClient(signal), authed, signal, now: new Date() };
}

/** Runs an optional request: failures become a warning instead of failing the whole report. */
export async function optional<T>(
  ctx: Ctx,
  warnings: string[],
  label: string,
  run: () => Promise<T>,
  options: { quietStatus?: number[] } = {},
): Promise<T | null> {
  try {
    return await run();
  } catch (error) {
    if (ctx.signal?.aborted) throw error;
    if (error instanceof GitHubError && options.quietStatus?.includes(error.status)) return null;
    warnings.push(`${label} unavailable. ${error instanceof Error ? error.message : ''}`.trim());
    return null;
  }
}

/**
 * "Open issue count unavailable. GitHub denied this request (forbidden)." three times
 * is one fact. Warnings that share a reason are merged into one line listing what
 * was affected, so panels and agents read (and pay for) it once.
 */
export function collapseWarnings(warnings: string[]): string[] {
  const byReason = new Map<string, string[]>();
  const out: string[] = [];
  for (const w of warnings) {
    const m = /^(.+?) unavailable\. (.+)$/.exec(w);
    if (!m) {
      out.push(w);
      continue;
    }
    const list = byReason.get(m[2]);
    if (list) list.push(m[1]);
    else {
      byReason.set(m[2], [m[1]]);
      out.push(`\u0000${m[2]}`); // placeholder keeps the first position
    }
  }
  return out.map((w) =>
    w.startsWith('\u0000') ? `${byReason.get(w.slice(1))!.join(', ')} unavailable. ${w.slice(1)}` : w,
  );
}

/** Uses GraphQL when signed in, falling back to REST (with a note) if GraphQL fails. */
export async function preferGraphql<T>(ctx: Ctx, graphql: () => Promise<T>, rest: () => Promise<T>): Promise<T> {
  if (!ctx.authed) return rest();
  try {
    return await graphql();
  } catch (error) {
    if (ctx.signal?.aborted || (error instanceof GitHubError && [404, 429].includes(error.status))) throw error;
    const result = await rest();
    const record = result as { warnings?: string[] };
    record.warnings?.push(
      `Used the standard API because GraphQL failed: ${error instanceof Error ? error.message : 'unknown error'}`,
    );
    return result;
  }
}

/* ---------- REST → normalized reply shapes ---------- */

type RestUser = { login?: string; type?: string } | null;
export type RestComment = {
  user: RestUser;
  author_association?: string;
  created_at?: string;
  html_url?: string;
  body?: string | null;
};
export type RestReview = RestComment & { submitted_at?: string; state?: string };

export const restComment = (c: RestComment): Reply => ({
  author: actor(c.user),
  association: c.author_association ?? 'NONE',
  at: c.created_at ?? '',
  url: c.html_url ?? '',
  kind: 'comment',
  body: c.body ?? undefined,
});

export const restReview = (r: RestReview): Reply => ({
  author: actor(r.user),
  association: r.author_association ?? 'NONE',
  at: r.submitted_at ?? r.created_at ?? '',
  url: r.html_url ?? '',
  kind: 'review',
});

/* ---------- GraphQL → normalized reply shapes ---------- */

export type GqlAuthor = { login: string; __typename?: string } | null;
export type GqlComment = {
  author: GqlAuthor;
  authorAssociation: string;
  createdAt: string;
  url: string;
  body?: string;
};
export type GqlReview = {
  author: GqlAuthor;
  authorAssociation: string;
  submittedAt: string | null;
  createdAt: string;
  url: string;
};

export const gqlComment = (c: GqlComment): Reply => ({
  author: actor(c.author),
  association: c.authorAssociation,
  at: c.createdAt,
  url: c.url,
  kind: 'comment',
  body: c.body,
});

export const gqlReview = (r: GqlReview): Reply => ({
  author: actor(r.author),
  association: r.authorAssociation,
  at: r.submittedAt ?? r.createdAt,
  url: r.url,
  kind: 'review',
});

export const AUTHOR = 'author { login __typename }';
export const COMMENT_FIELDS = `${AUTHOR} authorAssociation createdAt url`;
