/** Top-level GitHub paths that look like `owner/name` but are not repositories. */
const RESERVED_OWNERS = new Set([
  'about',
  'account',
  'advisories',
  'apps',
  'codespaces',
  'collections',
  'contact',
  'copilot',
  'customer-stories',
  'dashboard',
  'discussions',
  'education',
  'enterprise',
  'events',
  'explore',
  'features',
  'github-copilot',
  'issues',
  'join',
  'login',
  'logout',
  'marketplace',
  'models',
  'new',
  'notifications',
  'orgs',
  'organizations',
  'premium-support',
  'pricing',
  'pulls',
  'readme',
  'resources',
  'search',
  'security',
  'sessions',
  'settings',
  'signup',
  'site',
  'solutions',
  'sponsors',
  'stars',
  'team',
  'topics',
  'trending',
  'users',
  'watching',
]);

const OWNER = /^[a-z\d](?:[a-z\d-]{0,38})$/i;
const NAME = /^[a-z\d_.-]{1,100}$/i;

/**
 * Normalizes `owner/name`, `github.com/owner/name` or a full GitHub URL to `owner/name`.
 * Returns null for anything that is not a plausible public repository path.
 */
export function parseRepo(input: string): string | null {
  let value = input.trim().replace(/\/+$/, '');
  if (/^https?:\/\//i.test(value)) {
    try {
      const url = new URL(value);
      if (!['github.com', 'www.github.com'].includes(url.hostname.toLowerCase())) return null;
      value = url.pathname.replace(/^\/+/, '');
    } catch {
      return null;
    }
  } else {
    value = value.replace(/^(?:www\.)?github\.com\//i, '');
  }
  const [owner, rawName] = value.split('/');
  const name = rawName?.replace(/\.git$/i, '');
  if (!owner || !name || !OWNER.test(owner) || !NAME.test(name) || name === '.' || name === '..') return null;
  if (RESERVED_OWNERS.has(owner.toLowerCase())) return null;
  return `${owner}/${name}`;
}

export type PageContext = { repo: string | null; issue: number | null; pull: number | null };

/** Describes which repository (and issue or pull request) a GitHub URL points at. */
export function parsePage(href: string): PageContext {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return { repo: null, issue: null, pull: null };
  }
  if (url.hostname !== 'github.com') return { repo: null, issue: null, pull: null };
  const repo = parseRepo(url.href);
  if (!repo) return { repo: null, issue: null, pull: null };
  const [, , section, id] = url.pathname.split('/').filter(Boolean);
  const number = id && /^\d{1,9}$/.test(id) ? Number(id) : null;
  return {
    repo,
    issue: section === 'issues' ? number : null,
    pull: section === 'pull' ? number : null,
  };
}

export function repoPath(repo: string): string {
  const parsed = parseRepo(repo);
  if (!parsed) throw new Error('Enter a public repository as owner/name or a GitHub repository URL.');
  return `/repos/${parsed.split('/').map(encodeURIComponent).join('/')}`;
}

/**
 * Links rendered from API data must be plain https URLs on github.com. Preact
 * does not block `javascript:` hrefs, so anything else is dropped rather than
 * rendered, and a user-editable field such as a profile website can never
 * become a clickable link in the widget.
 */
export function safeHref(href: string | null | undefined): string | undefined {
  if (!href) return undefined;
  try {
    const url = new URL(href);
    const github = url.hostname === 'github.com' || url.hostname.endsWith('.github.com');
    return url.protocol === 'https:' && github && !url.username && !url.password ? url.href : undefined;
  } catch {
    return undefined;
  }
}
