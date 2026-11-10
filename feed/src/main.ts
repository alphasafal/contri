import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { API, clearMemory, setTransport } from '../../src/background/github';
import { createCtx } from '../../src/background/reports/context';
import { discover } from '../../src/background/reports/discover';
import { bulkInsight } from '../../src/background/reports/insight';
import { searchIssues } from '../../src/background/reports/issues';
import { publicRepo } from '../../src/background/reports/repo';
import { team } from '../../src/background/reports/team';
import { badgeFor, badgePath, buildFeed, parseRepoList } from './feed';

/**
 * Builds the public data set (see feed.ts) with a GitHub token and writes it to a folder:
 *   free-issues.json   issues that look free, in projects that answer contributors
 *   repos.json         the same projects ranked by how fast the team first replies
 *   badge/o/r.json     one shields.io endpoint file per project
 * Usage: GITHUB_TOKEN=… node feed/dist/feed.js <output folder>
 */

const out = process.argv[2] ?? 'feed-out';
const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? '';
if (!token) {
  console.error('GITHUB_TOKEN is required: the feed reads a few hundred public reports.');
  process.exit(1);
}

/** Keep this many requests in hand so a run always ends by publishing, not by hitting the limit. */
const RESERVE = 60;
const GAP_MS = 350;
const remaining: Record<string, number> = {};
let last = 0;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// One request at a time with a pause between them: this is a batch job on a shared API.
let queue: Promise<unknown> = Promise.resolve();
setTransport((url, init = {}) => {
  const task = queue.then(async () => {
    if (!url.startsWith(`${API}/`)) throw new Error('The feed only talks to api.github.com.');
    for (let attempt = 0; ; attempt++) {
      await sleep(Math.max(0, last + GAP_MS - Date.now()));
      const headers = new Headers(init.headers);
      headers.set('User-Agent', 'contri-feed');
      headers.set('Authorization', `Bearer ${token}`);
      const response = await fetch(url, { ...init, headers });
      last = Date.now();
      const resource = response.headers.get('x-ratelimit-resource') ?? 'core';
      const left = response.headers.get('x-ratelimit-remaining');
      if (left !== null) remaining[resource] = Number(left);
      // A secondary limit asks for a pause, not a stop: wait once as told, then carry on.
      const retryAfter = Number(response.headers.get('retry-after'));
      if (
        attempt === 0 &&
        (response.status === 429 || response.status === 403) &&
        retryAfter > 0 &&
        retryAfter <= 120
      ) {
        await response.body?.cancel().catch(() => {});
        await sleep(retryAfter * 1000);
        continue;
      }
      return response;
    }
  });
  queue = task.catch(() => {});
  return task;
});

const ctx = () => createCtx(true);
const perLanguage = Number(process.env.FEED_REPOS_PER_LANGUAGE);
const feed = await buildFeed({
  perLanguage: Number.isInteger(perLanguage) && perLanguage > 0 ? Math.min(perLanguage, 12) : undefined,
  optIn: parseRepoList(readFileSync(new URL('../repos.txt', import.meta.url), 'utf8')),
  log: (line) => console.log(line),
  reports: {
    discover: async (language) => (await discover(ctx(), { query: '', language, personalize: false })).rows,
    repo: async (repo) => {
      const r = await publicRepo(ctx(), repo);
      return { url: r.url, description: r.description, language: r.language, stars: r.stars };
    },
    team: (repo) => team(ctx(), repo),
    issues: async (repo) =>
      (
        await searchIssues(ctx(), {
          repo,
          label: 'good first issue',
          query: '',
          unassigned: true,
          sort: 'updated',
          page: 1,
        })
      ).items,
    verdicts: async (repo, numbers, roster) => {
      clearMemory(); // nothing is asked twice in one run, so the five-minute memo only costs memory
      return (await bulkInsight(ctx(), repo, numbers, new Map(roster.map((e) => [e.login.toLowerCase(), e])))).items;
    },
    // Search has its own small per-minute allowance that refills as the run goes; only the hourly ones end a run.
    budgetLeft: () => ['core', 'graphql'].every((r) => (remaining[r] ?? Infinity) > RESERVE),
  },
});

const write = (path: string, value: unknown) => {
  const file = join(out, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 1)}\n`);
};
write('free-issues.json', { generatedAt: feed.generatedAt, issues: feed.issues });
write('repos.json', { generatedAt: feed.generatedAt, repos: feed.repos, skipped: feed.skipped });
for (const repo of feed.repos) write(badgePath(repo.repo), badgeFor(repo));
console.log(
  `Wrote ${feed.issues.length} free issues in ${feed.repos.length} repositories to ${out} (${feed.skipped.length} skipped). Requests left: ${JSON.stringify(remaining)}`,
);
// An empty data set is a failed run: keep yesterday's files instead of publishing nothing.
if (!feed.repos.length) process.exit(1);
