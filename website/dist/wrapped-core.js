/**
 * Open Source Wrapped: the arithmetic. Pure functions over GitHub search results, so the
 * numbers can be tested without a browser. `wrapped.js` fetches, draws and shares.
 */

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** GitHub usernames: letters, digits and single hyphens, 39 at most. Anything else never reaches a query. */
export function validLogin(value) {
  const login = String(value ?? '').trim().replace(/^@/, '');
  return /^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/i.test(login) ? login : null;
}

export function validYear(value, now = new Date()) {
  const year = Number(value);
  return Number.isInteger(year) && year >= 2008 && year <= now.getUTCFullYear() ? year : now.getUTCFullYear();
}

/** The four searches behind a card. `is:public` keeps private repositories out even for signed-in tokens. */
export function queries(login, year) {
  const range = `${year}-01-01..${year}-12-31`;
  return {
    merged: `author:${login} type:pr is:merged is:public merged:${range}`,
    opened: `author:${login} type:pr is:public created:${range}`,
    issues: `author:${login} type:issue is:public created:${range}`,
    reviewed: `reviewed-by:${login} -author:${login} type:pr is:public created:${range}`,
  };
}

const repoOf = (item) => {
  const m = /\/repos\/([^/]+\/[^/]+)$/.exec(item?.repository_url ?? '');
  return m ? m[1] : null;
};

/**
 * @param input.merged  `{ total_count, items }` of the merged search (first page, oldest first)
 * Projects and months come from the items actually loaded; `sampled` says how many that was.
 */
export function summarize(input) {
  const { login, year } = input;
  const items = Array.isArray(input.merged?.items) ? input.merged.items : [];
  const mine = `${login.toLowerCase()}/`;
  const repos = new Map();
  const months = new Array(12).fill(0);
  let first = null;
  for (const item of items) {
    const repo = repoOf(item);
    if (repo) repos.set(repo, (repos.get(repo) ?? 0) + 1);
    const at = item.pull_request?.merged_at ?? item.closed_at;
    const date = at ? new Date(at) : null;
    if (date && !Number.isNaN(date.getTime()) && date.getUTCFullYear() === year) {
      months[date.getUTCMonth()]++;
      if (!first || date < first) first = date;
    }
  }
  const ranked = [...repos.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const outside = ranked.filter(([repo]) => !repo.toLowerCase().startsWith(mine));
  const top = Math.max(...months);
  const merged = input.merged?.total_count ?? 0;
  return {
    login,
    name: input.name || login,
    year,
    merged,
    opened: input.opened ?? 0,
    issues: input.issues ?? 0,
    reviewed: input.reviewed ?? 0,
    /** Distinct repositories among the loaded merged pull requests. */
    projects: ranked.length,
    /** Of those, repositories that are not the user's own: contributions to other people's projects. */
    otherProjects: outside.length,
    mergedElsewhere: outside.reduce((n, [, count]) => n + count, 0),
    topProjects: (outside.length ? outside : ranked).slice(0, 3).map(([repo, count]) => ({ repo, count })),
    busiestMonth: top > 0 ? MONTHS[months.indexOf(top)] : null,
    firstMerge: first ? first.toISOString().slice(0, 10) : null,
    sampled: items.length,
    /** True when the year has more merged pull requests than were loaded: projects are "at least". */
    partial: merged > items.length,
    title: titleFor(merged, outside.length),
  };
}

/** One line for the top of the card. Earned by the numbers, never by flattery. */
export function titleFor(merged, otherProjects) {
  if (merged === 0) return 'Getting started';
  if (otherProjects >= 10) return 'Everywhere at once';
  if (merged >= 100) return 'Merge machine';
  if (otherProjects >= 3) return 'Many projects, one contributor';
  if (merged >= 20) return 'Steady shipper';
  if (merged >= 5) return 'Finding a rhythm';
  return 'First merges of many';
}

export function shareText(s) {
  const projects = s.otherProjects
    ? ` across ${s.partial ? 'at least ' : ''}${s.otherProjects} project${s.otherProjects === 1 ? '' : 's'} that aren't mine`
    : '';
  return s.merged
    ? `My open source ${s.year}: ${s.merged} merged pull request${s.merged === 1 ? '' : 's'}${projects}. #OpenSourceWrapped`
    : `My open source ${s.year} starts now. #OpenSourceWrapped`;
}

/** What a screen reader gets instead of the picture. */
export function describe(s) {
  return [
    `${s.name}'s open source ${s.year}: ${s.title}.`,
    `${s.merged} merged pull requests, ${s.opened} opened, ${s.reviewed} reviewed for others, ${s.issues} issues opened.`,
    s.projects ? `${s.partial ? 'At least ' : ''}${s.projects} projects${s.otherProjects ? `, ${s.otherProjects} of them other people's` : ''}.` : '',
    s.topProjects.length ? `Most merged in: ${s.topProjects.map((p) => `${p.repo} (${p.count})`).join(', ')}.` : '',
    s.busiestMonth ? `Busiest month: ${s.busiestMonth}.` : '',
  ]
    .filter(Boolean)
    .join(' ');
}
