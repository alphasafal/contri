import {
  actor,
  firstTeamReply,
  isHuman,
  isOutsideAssociation,
  since,
  timing,
  type Event,
  type Thread,
  type Timing,
} from '../../core/metrics';
import {
  buildRoster,
  parseCodeowners,
  teamCheck,
  type IssueEvent,
  type RosterBasis,
  type RosterEntry,
} from '../../core/team';
import { repoPath } from '../../shared/repo';
import { splitRepo } from '../github';
import {
  collapseWarnings,
  AUTHOR,
  COMMENT_FIELDS,
  gqlComment,
  gqlReview,
  optional,
  preferGraphql,
  restComment,
  restReview,
  type Ctx,
  type GqlComment,
  type GqlReview,
  type RestComment,
  type RestReview,
} from './context';
import { publicRepo } from './repo';

export type Sample = {
  number: number;
  title: string;
  url: string;
  author: string;
  createdAt: string;
  hours: number | null;
  response?: Event;
  /** History was capped before any team reply was found, so timing is unknown. */
  partial: boolean;
};

export type Member = { login: string; basis: RosterBasis[]; responses: number; reviews: number; latest?: Event };

export type TeamReport = {
  source: 'graphql' | 'rest';
  groups: { pr: Sample[]; issue: Sample[] };
  summary: { pr: Timing; issue: Timing };
  members: Member[];
  roster: RosterEntry[];
  latestTeam: Event | null;
  latestHuman: Event | null;
  warnings: string[];
  checkedAt: string;
};

/** Pure: turns sampled threads plus roster signals into the team report. Exported for tests. */
export function summarizeTeam(
  threads: Thread[],
  signals: Parameters<typeof buildRoster>[0],
  source: TeamReport['source'],
  warnings: string[],
): TeamReport {
  const associations = threads.flatMap((t) =>
    t.replies.filter((r) => isHuman(r.author)).map((r) => ({ login: r.author!.login, association: r.association })),
  );
  const roster = buildRoster({ ...signals, associations });
  const isTeam = teamCheck(roster);
  const groups: TeamReport['groups'] = { pr: [], issue: [] };
  const members = new Map<string, Member>();
  const human: Event[] = [];
  const team: Event[] = [];

  for (const thread of threads) {
    const first = firstTeamReply(thread, isTeam);
    const partial = !thread.complete && first.hours === null;
    const toEvent = (r: Thread['replies'][number]): Event => ({
      at: r.at,
      url: r.url,
      kind: r.kind === 'review' ? 'Review' : 'Comment',
      login: r.author!.login,
      association: r.association,
    });
    groups[thread.kind].push({
      number: thread.number,
      title: thread.title,
      url: thread.url,
      author: thread.author?.login ?? 'ghost',
      createdAt: thread.createdAt,
      hours: partial ? null : first.hours,
      response: first.reply ? toEvent(first.reply) : undefined,
      partial,
    });
    for (const reply of thread.replies) {
      if (!isHuman(reply.author) || Date.parse(reply.at) > Date.now()) continue;
      const event = toEvent(reply);
      human.push(event);
      if (!isTeam(reply.author.login, reply.association)) continue;
      if (reply.author.login.toLowerCase() === thread.author?.login.toLowerCase()) continue;
      team.push(event);
      const key = reply.author.login.toLowerCase();
      const member = members.get(key) ?? {
        login: reply.author.login,
        basis: roster.get(key)?.basis ?? ['association'],
        responses: 0,
        reviews: 0,
      };
      member.responses++;
      if (reply.kind === 'review') member.reviews++;
      if (!member.latest || Date.parse(event.at) > Date.parse(member.latest.at)) member.latest = event;
      members.set(key, member);
    }
  }
  for (const [key, entry] of roster)
    if (!members.has(key)) members.set(key, { login: entry.login, basis: entry.basis, responses: 0, reviews: 0 });

  const newest = (events: Event[]) => events.sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0] ?? null;
  const ranked = [...members.values()].sort(
    (a, b) =>
      b.responses - a.responses ||
      Date.parse(b.latest?.at ?? '0') - Date.parse(a.latest?.at ?? '0') ||
      a.login.localeCompare(b.login),
  );
  return {
    source,
    groups,
    summary: {
      pr: timing(groups.pr.filter((s) => !s.partial).map((s) => s.hours)),
      issue: timing(groups.issue.filter((s) => !s.partial).map((s) => s.hours)),
    },
    members: ranked.slice(0, 15),
    roster: [...roster.values()],
    latestTeam: newest(team),
    latestHuman: newest(human),
    warnings: collapseWarnings(warnings),
    checkedAt: new Date().toISOString(),
  };
}

type RestEvent = {
  event: string;
  actor: { login: string; type?: string } | null;
  created_at: string;
  issue?: { user?: { login: string } | null; created_at?: string };
};

/** Recent issue/PR events reveal who can label, assign and merge: the people with triage or write access. */
async function triageEvents(ctx: Ctx, repo: string, warnings: string[]): Promise<IssueEvent[]> {
  const rows = await optional(ctx, warnings, 'Maintainer activity events', () =>
    ctx.client.rest<RestEvent[]>(`${repoPath(repo)}/issues/events?per_page=100`),
  );
  return (rows ?? []).map((e) => ({
    event: e.event,
    actor: actor(e.actor),
    at: e.created_at,
    issueAuthor: e.issue?.user?.login ?? null,
    issueCreatedAt: e.issue?.created_at ?? null,
  }));
}

type RestItem = {
  number: number;
  title: string;
  html_url: string;
  created_at: string;
  user: { login: string; type?: string } | null;
  author_association?: string;
  draft?: boolean;
};

async function viaRest(ctx: Ctx, repo: string): Promise<TeamReport> {
  const meta = await publicRepo(ctx, repo);
  const base = repoPath(repo);
  const warnings: string[] = [];
  const perKind = ctx.authed ? 20 : 10;
  const events = await triageEvents(ctx, repo, warnings);
  const codeowners = await optional(
    ctx,
    warnings,
    'CODEOWNERS',
    () => ctx.client.rest<{ content?: string }>(`${base}/contents/.github/CODEOWNERS`),
    { quietStatus: [404] },
  );
  const owners = codeowners?.content ? parseCodeowners(atob(codeowners.content.replace(/\s/g, ''))) : [];
  const preliminary = buildRoster({ owner: meta.owner, events, codeowners: owners });
  const threads: Thread[] = [];
  for (const kind of ['pr', 'issue'] as const) {
    const q = `repo:${repo} is:${kind} created:>=${since(ctx.now.getTime()).slice(0, 10)}${kind === 'pr' ? ' -is:draft' : ''}`;
    const found = await optional(ctx, warnings, `${kind === 'pr' ? 'Pull request' : 'Issue'} sample`, () =>
      ctx.client.rest<{ items: RestItem[]; incomplete_results: boolean }>(
        `/search/issues?q=${encodeURIComponent(q)}&sort=created&order=desc&per_page=50`,
      ),
    );
    if (!found) continue;
    const items = found.items
      .filter(
        (i) =>
          !i.draft &&
          isHuman(actor(i.user)) &&
          isOutsideAssociation(i.author_association) &&
          !preliminary.has(i.user!.login.toLowerCase()),
      )
      .slice(0, perKind);
    for (const item of items) {
      if (ctx.signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
      try {
        const comments = await ctx.client.rest<RestComment[]>(`${base}/issues/${item.number}/comments?per_page=100`);
        const reviews =
          kind === 'pr' ? await ctx.client.rest<RestReview[]>(`${base}/pulls/${item.number}/reviews?per_page=100`) : [];
        threads.push({
          kind,
          number: item.number,
          title: item.title,
          url: item.html_url,
          createdAt: item.created_at,
          author: actor(item.user),
          association: item.author_association ?? 'NONE',
          replies: [...comments.map(restComment), ...reviews.map(restReview)],
          complete: comments.length < 100 && reviews.length < 100,
        });
      } catch (error) {
        if (ctx.signal?.aborted) throw error;
        warnings.push(
          `${kind} #${item.number}: history unavailable and excluded. ${error instanceof Error ? error.message : ''}`,
        );
        if ((ctx.client.left() ?? 99) <= 3) break;
      }
    }
  }
  if (!ctx.authed) warnings.push(`Anonymous mode samples ${perKind} items of each kind. Sign in to sample 20.`);
  return summarizeTeam(threads, { owner: meta.owner, events, codeowners: owners }, 'rest', warnings);
}

const TEAM_QUERY = `
query Team($owner: String!, $name: String!, $prs: String!, $issues: String!) {
  repository(owner: $owner, name: $name) {
    isPrivate
    owner { login __typename }
    merged: pullRequests(states: MERGED, first: 50, orderBy: { field: UPDATED_AT, direction: DESC }) {
      nodes { mergedBy { login } }
    }
    co1: object(expression: "HEAD:.github/CODEOWNERS") { ... on Blob { text } }
    co2: object(expression: "HEAD:CODEOWNERS") { ... on Blob { text } }
    co3: object(expression: "HEAD:docs/CODEOWNERS") { ... on Blob { text } }
  }
  prs: search(query: $prs, type: ISSUE, first: 40) {
    nodes {
      ... on PullRequest {
        number title url createdAt isDraft authorAssociation ${AUTHOR}
        comments(first: 30) { totalCount nodes { ${COMMENT_FIELDS} } }
        reviews(first: 30) { totalCount nodes { ${COMMENT_FIELDS} submittedAt } }
      }
    }
  }
  issues: search(query: $issues, type: ISSUE, first: 40) {
    nodes {
      ... on Issue {
        number title url createdAt authorAssociation ${AUTHOR}
        comments(first: 30) { totalCount nodes { ${COMMENT_FIELDS} } }
      }
    }
  }
}`;

type Conn<T> = { totalCount: number; nodes: T[] };
type GqlItem = {
  number?: number;
  title: string;
  url: string;
  createdAt: string;
  isDraft?: boolean;
  authorAssociation: string;
  author: { login: string; __typename?: string } | null;
  comments: Conn<GqlComment>;
  reviews?: Conn<GqlReview>;
};
type TeamData = {
  repository: {
    isPrivate: boolean;
    owner: { login: string; __typename: string };
    merged: { nodes: Array<{ mergedBy: { login: string } | null }> };
    co1: { text?: string } | null;
    co2: { text?: string } | null;
    co3: { text?: string } | null;
  } | null;
  prs: { nodes: GqlItem[] };
  issues: { nodes: GqlItem[] };
};

async function viaGraphql(ctx: Ctx, repo: string): Promise<TeamReport> {
  await publicRepo(ctx, repo);
  const warnings: string[] = [];
  const from = since(ctx.now.getTime()).slice(0, 10);
  const events = await triageEvents(ctx, repo, warnings);
  const { data, errors } = await ctx.client.graphql<TeamData>(TEAM_QUERY, {
    ...splitRepo(repo),
    prs: `repo:${repo} is:pr created:>=${from} -is:draft sort:created-desc`,
    issues: `repo:${repo} is:issue created:>=${from} sort:created-desc`,
  });
  warnings.push(...errors.map((e) => `Partial data from GitHub: ${e}`));
  const r = data.repository;
  if (!r || r.isPrivate) throw new Error('Only public repositories are supported.');
  const owner = { login: r.owner.login, type: r.owner.__typename };
  const codeowners = parseCodeowners([r.co1?.text, r.co2?.text, r.co3?.text].filter(Boolean).join('\n'));
  const mergedBy = r.merged.nodes.map((n) => n.mergedBy?.login);
  const preliminary = buildRoster({ owner, events, codeowners, mergedBy });
  const pick = (nodes: GqlItem[], kind: Thread['kind']): Thread[] =>
    nodes
      .filter((n) => n.number && !n.isDraft)
      .filter((n) => {
        const who = actor(n.author);
        return isHuman(who) && isOutsideAssociation(n.authorAssociation) && !preliminary.has(who.login.toLowerCase());
      })
      .slice(0, 20)
      .map((n) => ({
        kind,
        number: n.number!,
        title: n.title,
        url: n.url,
        createdAt: n.createdAt,
        author: actor(n.author),
        association: n.authorAssociation,
        replies: [...n.comments.nodes.map(gqlComment), ...(n.reviews?.nodes ?? []).map(gqlReview)],
        complete:
          n.comments.totalCount <= n.comments.nodes.length &&
          (!n.reviews || n.reviews.totalCount <= n.reviews.nodes.length),
      }));
  const threads = [...pick(data.prs.nodes, 'pr'), ...pick(data.issues.nodes, 'issue')];
  return summarizeTeam(threads, { owner, events, codeowners, mergedBy }, 'graphql', warnings);
}

export const team = (ctx: Ctx, repo: string) =>
  preferGraphql(
    ctx,
    () => viaGraphql(ctx, repo),
    () => viaRest(ctx, repo),
  );
