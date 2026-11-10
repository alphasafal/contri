import type { ListVerdict } from '../background/reports/insight';
import { call } from '../shared/protocol';
import { parseRepo } from '../shared/repo';
import { githubTheme } from './theme';

/**
 * A small verdict next to every title on a repository's issue list: "Looks free",
 * "Open PR #12", "Claimed by @sam". One GraphQL request covers the whole page, so it
 * only runs when signed in; anonymously a list would cost about three requests per issue.
 */

/** Same cap as the background report (`BULK_LIMIT`): GitHub lists 25 issues per page. */
export const LIST_LIMIT = 30;
/** A list that keeps changing (live updates, "load more") asks again at most this often. */
const MIN_GAP_MS = 5_000;

const MARK = 'list-badge';

const LIST_CSS = `
:host{all:initial;display:inline-flex;vertical-align:middle;margin:0 0 0 8px;font:500 11px/1.5 "Contri Sans",system-ui,sans-serif}
span.pill{display:inline-flex;align-items:center;gap:5px;max-width:230px;padding:1px 8px 1px 6px;border-radius:999px;
  color:#2c4443;border:1px solid #47626359;background:#4762631c;cursor:help}
:host([data-theme=dark]) span.pill{color:#d9e8e1;border-color:#9fc0b85c;background:#9fc0b824}
.dot{width:7px;height:7px;border-radius:50%;flex:none;background:#8a9690}
.good .dot{background:#2f9e5b}.warn .dot{background:#c9941a}.busy .dot{background:#d1604a}
:host([data-theme=dark]) .good .dot{background:#8fd6a8}:host([data-theme=dark]) .warn .dot{background:#f2cf7c}:host([data-theme=dark]) .busy .dot{background:#f0a08e}
.label{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
`;

/** `/owner/name/issues` exactly: the list, not one issue and not `/issues/new`. */
export function isIssueListPath(pathname: string): boolean {
  const parts = pathname.split('/').filter(Boolean);
  return parts.length === 3 && parts[2] === 'issues';
}

/** The issue number a link points at, when it is an issue of this repository. */
export function issueNumberOf(href: string, repo: string): number | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  if (url.hostname !== 'github.com') return null;
  const [owner, name, section, id, ...rest] = url.pathname.split('/').filter(Boolean);
  if (rest.length || section !== 'issues' || !id || !/^\d{1,9}$/.test(id)) return null;
  if (parseRepo(`${owner}/${name}`)?.toLowerCase() !== repo.toLowerCase()) return null;
  const number = Number(id);
  return number > 0 ? number : null;
}

/**
 * Title links in GitHub's issue list. GitHub has shipped two list layouts; both are tried by
 * their own markers first. If neither matches (a layout change), any link in the page's main
 * area that points at an issue and has visible text is used, first one per issue.
 */
const TITLE_SELECTORS = [
  'a[data-testid="issue-pr-title-link"]',
  'a[id^="issue_"][id$="_link"]',
  'a.js-navigation-open[data-hovercard-type="issue"]',
].join(',');

function titleLinks(repo: string): Map<number, HTMLAnchorElement> {
  let anchors = [...document.querySelectorAll<HTMLAnchorElement>(TITLE_SELECTORS)];
  if (!anchors.length)
    anchors = [...document.querySelectorAll<HTMLAnchorElement>('main a[href], [role="main"] a[href]')].filter(
      (a) => (a.textContent ?? '').trim().length > 3 && !a.getAttribute('aria-label')?.match(/comment/i),
    );
  const found = new Map<number, HTMLAnchorElement>();
  for (const a of anchors) {
    if (found.size >= LIST_LIMIT) break;
    const number = issueNumberOf(a.href, repo);
    if (number && !found.has(number)) found.set(number, a);
  }
  return found;
}

function createPill(v: ListVerdict): HTMLElement {
  const host = document.createElement('span');
  host.dataset.contri = MARK;
  host.dataset.number = String(v.number);
  host.dataset.label = v.label;
  host.dataset.theme = githubTheme();
  host.setAttribute('role', 'note');
  host.setAttribute('aria-label', `CONTRI: ${v.label}. ${v.detail}`);
  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = LIST_CSS;
  const pill = document.createElement('span');
  pill.className = `pill ${v.tone}`;
  pill.title = v.detail;
  const dot = document.createElement('span');
  dot.className = 'dot';
  const label = document.createElement('span');
  label.className = 'label';
  label.textContent = v.label;
  pill.append(dot, label);
  shadow.append(style, pill);
  return host;
}

type State = { key: string; verdicts: Map<number, ListVerdict> | null; requestedAt: number };
let state: State = { key: '', verdicts: null, requestedAt: 0 };

const pills = () => document.querySelectorAll<HTMLElement>(`[data-contri="${MARK}"]`);

export function clearListBadges(forget = false) {
  for (const el of pills()) el.remove();
  if (forget) state = { key: '', verdicts: null, requestedAt: 0 };
}

function paint(links: Map<number, HTMLAnchorElement>) {
  const verdicts = state.verdicts;
  if (!verdicts) return;
  const theme = githubTheme();
  // GitHub re-renders rows; a pill that lost its title link, or shows an older verdict, goes.
  for (const el of pills()) {
    const number = Number(el.dataset.number);
    const link = links.get(number);
    const current = verdicts.get(number);
    if (!link || !current || link.nextElementSibling !== el || el.dataset.label !== current.label) el.remove();
    else el.dataset.theme = theme;
  }
  for (const [number, link] of links) {
    const v = verdicts.get(number);
    if (!v) continue;
    const next = link.nextElementSibling as HTMLElement | null;
    if (next?.dataset?.contri === MARK && next.dataset.number === String(number)) continue;
    link.insertAdjacentElement('afterend', createPill(v));
  }
}

/** Called on every badge tick while an issue list is open. Cheap: one selector query unless the list changed. */
export function listBadges(repo: string) {
  const links = titleLinks(repo);
  if (!links.size) return;
  const numbers = [...links.keys()].sort((a, b) => a - b);
  const key = `${repo.toLowerCase()}:${numbers.join(',')}`;
  if (key === state.key) return paint(links);
  if (Date.now() - state.requestedAt < MIN_GAP_MS) return;
  state = { key, verdicts: null, requestedAt: Date.now() };
  clearListBadges();
  void call('insights', { repo, numbers })
    .then((report) => {
      if (state.key !== key) return;
      state.verdicts = new Map(report.items.map((item) => [item.number, item]));
      paint(titleLinks(repo));
    })
    .catch(() => {
      // No pills is the honest result of a failed check; the next navigation tries again.
    });
}
