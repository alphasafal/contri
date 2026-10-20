import type { InsightReport } from '../background/reports/insight';
import { recentMerges } from '../core/metrics';
import { verdict, type Verdict } from '../core/verdict';
import { count, hours } from '../shared/format';
import { call, peek, type BadgeMode } from '../shared/protocol';
import { parsePage } from '../shared/repo';
import { onNavigate } from './navigation';
import { githubTheme } from './theme';

/**
 * Small native-feeling badges inside GitHub's own UI:
 *  - next to an issue title: "Looks free" / "Open PR #12" / "Claimed by @x"
 *  - in a repository's About sidebar: recent merges and team reply time
 * They never spend GitHub requests unless the user is signed in or clicks them.
 */

export const OPEN_EVENT = 'contri:open';

const BADGE_CSS = `
:host{all:initial;display:inline-block;margin:6px 0 2px;font:12px/1.4 "Contri Sans",system-ui,sans-serif}
button{all:unset;cursor:pointer;display:inline-flex;align-items:center;gap:7px;padding:5px 11px 5px 8px;border-radius:999px;
  color:#f3f6ee;border:1px solid #ffffff75;background:linear-gradient(145deg,#476263f0,#304a48f2 58%,#3e5143f0);
  box-shadow:0 4px 14px #122a302b,inset 0 1px 0 #ffffff35;max-width:100%}
:host([data-theme=dark]) button{border-color:#ffffff3d;background:linear-gradient(145deg,#2a3f3ff2,#1c2e2cf5 58%,#243328f2);box-shadow:0 4px 14px #0000004d,inset 0 1px 0 #ffffff22}
button:hover{filter:brightness(1.08)}
button:focus-visible{outline:2px solid #fce9b6;outline-offset:2px}
.brand{display:inline-flex;align-items:center;gap:4px;font-weight:600;letter-spacing:-.04em;font-size:13px;padding-right:7px;margin-right:1px;border-right:1px solid #ffffff38}.brand svg{width:15px;height:15px;flex:none}
.dot{width:8px;height:8px;border-radius:50%;flex:none;background:#d4e2da}
.good .dot{background:#8fd6a8}.warn .dot{background:#f2cf7c}.busy .dot{background:#f0a08e}.unknown .dot{background:#cfd8d2}
.label{font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.muted{opacity:.8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.spin{width:9px;height:9px;border-radius:50%;border:2px solid #ffffff40;border-top-color:#fce9b6;animation:s .9s linear infinite}
@keyframes s{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion:reduce){.spin{animation:none}}
`;

export type Settings = { mode: BadgeMode; signedIn: boolean };

function createBadge(id: string) {
  const host = document.createElement('div');
  host.id = id;
  host.dataset.contri = 'badge';
  host.dataset.theme = githubTheme();
  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = BADGE_CSS;
  const button = document.createElement('button');
  shadow.append(style, button);
  return { host, button };
}

function render(
  button: HTMLButtonElement,
  parts: { tone?: Verdict['tone']; label: string; detail?: string; loading?: boolean; title?: string },
) {
  button.className = parts.tone ?? '';
  button.title = parts.title ?? '';
  button.replaceChildren();
  const add = (cls: string, text = '') => {
    const el = document.createElement('span');
    el.className = cls;
    el.textContent = text;
    button.append(el);
  };
  button.append(brand());
  add(parts.loading ? 'spin' : 'dot');
  add('label', parts.label);
  if (parts.detail) add('muted', parts.detail);
}

const SVG = 'http://www.w3.org/2000/svg';

/** The contri. symbol + wordmark, built with DOM APIs (no innerHTML on GitHub pages). */
function brand() {
  const wrap = document.createElement('span');
  wrap.className = 'brand';
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 100 100');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('aria-hidden', 'true');
  const circle = document.createElementNS(SVG, 'circle');
  for (const [k, v] of Object.entries({
    cx: '50',
    cy: '50',
    r: '44',
    stroke: 'currentColor',
    'stroke-opacity': '.62',
    'stroke-width': '7',
  }))
    circle.setAttribute(k, v);
  const arrow = document.createElementNS(SVG, 'path');
  for (const [k, v] of Object.entries({
    d: 'M30 81 74 15M55 20.5l19-5.5 2 19',
    stroke: 'currentColor',
    'stroke-width': '9',
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
  }))
    arrow.setAttribute(k, v);
  svg.append(circle, arrow);
  const text = document.createElement('span');
  text.textContent = 'contri.';
  wrap.append(svg, text);
  return wrap;
}

const openWidget = () => window.dispatchEvent(new CustomEvent(OPEN_EVENT));

/* ---------- issue title badge ---------- */

function issueAnchor(): Element | null {
  const title =
    document.querySelector('[data-testid="issue-title"]') ??
    document.querySelector('.gh-header-title') ??
    document.querySelector('.js-issue-title');
  return title?.closest('h1') ?? title ?? null;
}

const ISSUE_ID = 'contri-issue-badge';

function issueBadge(repo: string, number: number, settings: Settings, state: Map<string, InsightReport | 'error'>) {
  const anchor = issueAnchor();
  if (!anchor) return;
  const key = `${repo}#${number}`;
  const host = document.getElementById(ISSUE_ID);
  if (host && host.dataset.key === key) {
    if (!host.isConnected || host.previousElementSibling !== anchor) anchor.insertAdjacentElement('afterend', host);
    return;
  }
  host?.remove();
  const badge = createBadge(ISSUE_ID);
  badge.host.dataset.key = key;
  anchor.insertAdjacentElement('afterend', badge.host);

  const show = (report: InsightReport) => {
    const v = verdict({
      repo,
      issueState: report.issue.state,
      link: report.link,
      claim: report.claim,
      discussion: report.discussion,
      comments: report.issue.comments,
    });
    render(badge.button, { tone: v.tone, label: v.label, detail: 'Open details', title: v.detail });
    badge.button.onclick = openWidget;
  };
  const load = async (force = false) => {
    render(badge.button, { loading: true, label: 'Checking availability…' });
    try {
      const report = await call('insight', { repo, number }, { force });
      state.set(key, report);
      if (badge.host.dataset.key === key) show(report);
    } catch (e) {
      state.set(key, 'error');
      render(badge.button, { tone: 'unknown', label: 'Check failed', detail: 'Retry', title: (e as Error).message });
      badge.button.onclick = () => void load(true);
    }
  };

  const known = state.get(key);
  if (known && known !== 'error') return show(known);
  const auto = settings.mode === 'always' || (settings.mode === 'smart' && settings.signedIn);
  void peek('insight', { repo, number }).then((cached) => {
    if (badge.host.dataset.key !== key) return;
    if (cached) return show(cached);
    if (auto) return void load();
    render(badge.button, { tone: 'unknown', label: 'Can I work on this?', detail: 'Check' });
    badge.button.onclick = () => void load();
  });
}

/* ---------- repository sidebar badge ---------- */

const REPO_ID = 'contri-repo-badge';

function repoAnchor(): Element | null {
  const headings = document.querySelectorAll('.Layout-sidebar h2, [data-testid="repository-sidebar"] h2, aside h2');
  for (const h of headings) if (h.textContent?.trim() === 'About') return h;
  return null;
}

function repoBadge(repo: string, settings: Settings) {
  const anchor = repoAnchor();
  if (!anchor) return;
  const host = document.getElementById(REPO_ID);
  if (host && host.dataset.key === repo) {
    if (!host.isConnected || host.previousElementSibling !== anchor) anchor.insertAdjacentElement('afterend', host);
    return;
  }
  host?.remove();
  const badge = createBadge(REPO_ID);
  badge.host.dataset.key = repo;
  anchor.insertAdjacentElement('afterend', badge.host);
  badge.button.onclick = openWidget;
  render(badge.button, { label: 'Contribution signals', detail: 'Open' });

  const auto = settings.mode === 'always' || (settings.mode === 'smart' && settings.signedIn);
  void (async () => {
    const overview = auto
      ? await call('overview', { repo }).catch(() => null)
      : await peek('overview', { repo }).catch(() => null);
    const team = await peek('team', { repo }).catch(() => null);
    if (badge.host.dataset.key !== repo) return;
    const parts: string[] = [];
    if (overview?.mergedExact != null) parts.push(`${count(overview.mergedExact)} PRs merged · 90d`);
    const median = team?.summary.pr.sufficient
      ? team.summary.pr.medianHours
      : team?.summary.issue.sufficient
        ? team.summary.issue.medianHours
        : null;
    if (median != null) parts.push(`team replies ~${hours(median)}`);
    if (!parts.length) return;
    const recent = overview ? recentMerges(overview.sample) : null;
    render(badge.button, {
      tone: recent === null ? undefined : recent > 0 ? 'good' : 'warn',
      label: parts[0],
      detail: parts[1],
      title: 'Open contri. for details',
    });
  })();
}

/* ---------- lifecycle ---------- */

/** Badges only exist on repository pages; everywhere else no timer runs at all. */
export function needsBadgeTimer(settings: Settings | null, href: string): boolean {
  return Boolean(settings && settings.mode !== 'off' && parsePage(href).repo);
}

export function startBadges(): () => void {
  const state = new Map<string, InsightReport | 'error'>();
  let settings: Settings | null = null;
  let timer: ReturnType<typeof setInterval> | undefined;

  const loadSettings = async () => {
    const [prefs, connection] = await Promise.all([call('prefs', {}), call('connection', {})]);
    settings = { mode: prefs.badges, signedIn: connection.connected };
  };

  const tick = () => {
    if (!settings || settings.mode === 'off') return;
    const page = parsePage(location.href);
    if (!page.repo) return;
    if (page.issue) issueBadge(page.repo, page.issue, settings, state);
    else document.getElementById(ISSUE_ID)?.remove();
    const isRepoHome = location.pathname.replace(/\/+$/, '').split('/').filter(Boolean).length === 2;
    if (isRepoHome) repoBadge(page.repo, settings);
    else document.getElementById(REPO_ID)?.remove();
  };

  // GitHub re-renders headers often; a cheap re-check re-attaches our badge without watching the DOM.
  const schedule = () => {
    if (timer) clearInterval(timer);
    timer = undefined;
    tick();
    if (needsBadgeTimer(settings, location.href))
      timer = setInterval(() => {
        if (!document.hidden) tick();
      }, 2000);
  };

  void loadSettings()
    .then(schedule)
    .catch(() => {});
  const stopNav = onNavigate(() => {
    void loadSettings()
      .then(schedule)
      .catch(() => {});
  });
  return () => {
    stopNav();
    if (timer) clearInterval(timer);
  };
}
