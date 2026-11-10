/**
 * The "Free right now" list and the reply-time leaderboard. Both read static JSON that a
 * scheduled workflow publishes to the repository's feed-data branch (feed/ in the source).
 * No CONTRI server, no analytics; the only request is for that JSON.
 */
export const DATA = 'https://raw.githubusercontent.com/alphasafal/contri/feed-data/';
export const SITE = 'https://contri-two.vercel.app';

/** Same rounding as the extension: 45m, 6.5h, 2.5d. */
export function hours(value) {
  if (value === null || value === undefined) return '—';
  const minutes = Math.round(value * 60);
  if (minutes < 60) return `${minutes}m`;
  const tenths = Math.round(value * 10) / 10;
  if (tenths < 48) return `${tenths}h`;
  return `${Math.round((value / 24) * 10) / 10}d`;
}

/** Data comes from GitHub and is shown as links: only plain https://github.com URLs are ever linked. */
export function githubUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && u.hostname === 'github.com' && !u.username && !u.password ? u.href : null;
  } catch {
    return null;
  }
}

export function ago(iso, now = Date.now()) {
  const minutes = Math.round((now - Date.parse(iso)) / 60000);
  if (!Number.isFinite(minutes)) return '';
  if (minutes < 60) return minutes <= 1 ? 'just now' : `${minutes} minutes ago`;
  const h = Math.round(minutes / 60);
  if (h < 48) return `${h} hour${h === 1 ? '' : 's'} ago`;
  return `${Math.round(h / 24)} days ago`;
}

/** Languages present in the list, most issues first. */
export function languagesOf(issues) {
  const counts = new Map();
  for (const i of issues) if (i.language) counts.set(i.language, (counts.get(i.language) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([name]) => name);
}

export const badgeUrl = (repo) =>
  `https://img.shields.io/endpoint?url=${encodeURIComponent(`${DATA}badge/${repo.toLowerCase()}.json`)}`;
export const badgeMarkdown = (repo) =>
  `[![first reply to contributors](${badgeUrl(repo)})](${SITE}/repos)`;

const stars = (n) => (n >= 1000 ? `${Math.round(n / 100) / 10}k` : String(n));

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else node.setAttribute(k, v === true ? '' : v);
  }
  node.append(...children.filter((c) => c !== null && c !== undefined && c !== false));
  return node;
}
const external = (href, props, ...children) => {
  const safe = githubUrl(href);
  return safe ? el('a', { href: safe, target: '_blank', rel: 'noreferrer', ...props }, ...children) : el('span', props, ...children);
};

async function load(file) {
  const response = await fetch(`${DATA}${file}`, { cache: 'no-cache' });
  if (!response.ok) throw new Error(String(response.status));
  return response.json();
}

function failed(root, error) {
  root.replaceChildren(
    el(
      'div',
      { class: 'notice', role: 'status' },
      error.message === '404'
        ? 'The first list is being prepared. It is rebuilt every day from public GitHub data; check back soon.'
        : 'The list could not be loaded right now. Please try again in a minute.',
    ),
  );
}

async function initIssues(root) {
  let data;
  try {
    data = await load('free-issues.json');
  } catch (error) {
    return failed(root, error);
  }
  const issues = Array.isArray(data.issues) ? data.issues : [];
  const chips = el('div', { class: 'chips', role: 'group', 'aria-label': 'Filter by language' });
  const list = el('ul', { class: 'rows' });
  const count = el('p', { class: 'meta-line', role: 'status' });
  let language = new URLSearchParams(location.search).get('language') ?? '';
  const names = languagesOf(issues);
  if (!names.includes(language)) language = '';

  const draw = () => {
    for (const b of chips.children) b.setAttribute('aria-pressed', String(b.dataset.language === language));
    const shown = issues.filter((i) => !language || i.language === language);
    count.textContent = `${shown.length} issue${shown.length === 1 ? '' : 's'} that looked free when checked ${ago(data.generatedAt)}.`;
    list.replaceChildren(
      ...shown.map((i) =>
        el(
          'li',
          {},
          external(i.url, { class: 'title' }, el('span', { class: 'free-dot', 'aria-hidden': 'true' }), i.title),
          el(
            'div',
            { class: 'side' },
            el('b', { text: i.replyHours === null ? '—' : `~${hours(i.replyHours)}` }),
            i.replyHours === null ? 'reply time unknown' : 'typical first reply',
          ),
          el(
            'div',
            { class: 'sub' },
            el('span', { text: `${i.repo}#${i.number}` }),
            i.language ? el('span', { text: i.language }) : null,
            el('span', { text: `★ ${stars(i.stars)}` }),
            el('span', { text: `${i.comments} comment${i.comments === 1 ? '' : 's'}` }),
            ...i.labels.slice(0, 3).map((l) => el('span', { text: l })),
          ),
        ),
      ),
    );
    if (!shown.length) list.append(el('li', {}, el('span', { class: 'sub', text: 'Nothing listed for this language today.' })));
  };
  for (const name of ['', ...names]) {
    const b = el('button', { type: 'button', text: name || 'All languages', 'data-language': name });
    b.addEventListener('click', () => {
      language = name;
      const url = new URL(location.href);
      if (name) url.searchParams.set('language', name);
      else url.searchParams.delete('language');
      history.replaceState(null, '', url);
      draw();
    });
    chips.append(b);
  }
  root.replaceChildren(chips, count, list);
  draw();
}

async function initRepos(root) {
  let data;
  try {
    data = await load('repos.json');
  } catch (error) {
    return failed(root, error);
  }
  const repos = Array.isArray(data.repos) ? data.repos : [];
  const known = repos.filter((r) => r.reply);
  const list = el('ul', { class: 'rows' });
  const row = (r, rank) => {
    const copy = el('button', { type: 'button', class: 'copy', text: 'Copy README badge' });
    copy.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(badgeMarkdown(r.repo));
        copy.textContent = 'Copied';
      } catch {
        copy.textContent = 'Copy failed';
      }
      setTimeout(() => (copy.textContent = 'Copy README badge'), 1800);
    });
    return el(
      'li',
      {},
      el(
        'div',
        {},
        rank ? el('span', { class: 'rank', text: String(rank).padStart(2, '0') }) : null,
        external(r.url, { class: 'title' }, r.repo),
      ),
      el(
        'div',
        { class: 'side' },
        el('b', { text: r.reply ? `~${hours(r.reply.hours)}` : '—' }),
        r.reply ? `median first reply · ${r.reply.answered} of ${r.reply.sampled} ${r.reply.basis} answered` : 'not enough evidence yet',
        el('div', {}, copy),
      ),
      el(
        'div',
        { class: 'sub' },
        r.language ? el('span', { text: r.language }) : null,
        el('span', { text: `★ ${stars(r.stars)}` }),
        r.merges90 === null ? null : el('span', { text: `${r.merges90}${r.merges90 >= 50 ? '+' : ''} human merges · 90d` }),
        r.listed === 'opt-in' ? el('span', { text: 'added by its maintainers' }) : null,
      ),
    );
  };
  list.append(...known.map((r, i) => row(r, i + 1)), ...repos.filter((r) => !r.reply).map((r) => row(r, 0)));
  const skipped = Array.isArray(data.skipped) ? data.skipped.filter((s) => !String(s.repo).startsWith('language:')) : [];
  root.replaceChildren(
    el('p', {
      class: 'meta-line',
      role: 'status',
      text: `${known.length} of ${repos.length} projects had enough recent outside contributions to time. Checked ${ago(data.generatedAt)}.`,
    }),
    list,
    skipped.length
      ? el('p', { class: 'meta-line', text: `Not read this time: ${skipped.map((s) => s.repo).join(', ')}.` })
      : null,
  );
}

const root = typeof document === 'undefined' ? null : document.getElementById('feed');
if (root?.dataset.feed === 'issues') initIssues(root);
if (root?.dataset.feed === 'repos') initRepos(root);
