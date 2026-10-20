/**
 * Node counterpart of `src/background/transport.ts`: adds the token, keeps at
 * most two GitHub requests in flight, and stops sending for a while when GitHub
 * asks it to slow down. Agents call tools in loops, so this matters more here
 * than in the browser.
 */

const MAX_CONCURRENT = 2;
const GAP_MS = 80;

export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

export function createTransport(token: string | undefined, base: Fetcher = (url, init) => fetch(url, init)) {
  let active = 0;
  const waiting: Array<() => void> = [];
  let blockedUntil = 0;

  async function acquire() {
    if (active < MAX_CONCURRENT) {
      active++;
      return;
    }
    await new Promise<void>((resolve) => waiting.push(resolve));
  }

  function release() {
    const next = waiting.shift();
    if (next) setTimeout(next, GAP_MS);
    else active--;
  }

  const capacity: Record<string, { remaining: number; reset: string | null }> = {};

  const block = (until: number) => {
    blockedUntil = Math.max(blockedUntil, until);
  };

  const fetcher: Fetcher = async (url, init = {}) => {
    // The token is only ever attached to GitHub's API host.
    if (new URL(url).origin !== 'https://api.github.com') throw new Error('CONTRI only talks to api.github.com.');
    await acquire();
    try {
      if (init.signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
      if (Date.now() < blockedUntil)
        throw new Error(
          `GitHub asked CONTRI to slow down. Try again after ${new Date(blockedUntil).toLocaleTimeString()}.`,
        );
      const headers = new Headers(init.headers);
      headers.set('User-Agent', 'contri-mcp');
      if (token) headers.set('Authorization', `Bearer ${token}`);
      const response = await base(url, { ...init, headers });
      const remaining = response.headers.get('x-ratelimit-remaining');
      const reset = Number(response.headers.get('x-ratelimit-reset'));
      if (remaining !== null)
        capacity[response.headers.get('x-ratelimit-resource') ?? 'core'] = {
          remaining: Number(remaining),
          reset: reset ? new Date(reset * 1000).toISOString() : null,
        };
      if (response.status === 429 || (response.status === 403 && remaining === '0'))
        block(reset * 1000 || Date.now() + 60_000);
      const retryAfter = Number(response.headers.get('retry-after'));
      if (retryAfter > 0) block(Date.now() + retryAfter * 1000);
      if (response.status === 403 && remaining !== '0') {
        const body = (await response
          .clone()
          .json()
          .catch(() => ({}))) as { message?: string };
        if (/secondary rate|abuse detection/i.test(body.message ?? '')) block(Date.now() + 60_000);
      }
      if (response.status === 401 && token)
        // "sign-in" keeps GitHubClient from rewording this as a network error.
        throw new Error(
          'GitHub rejected the sign-in in GITHUB_TOKEN (expired or revoked). Update it in your MCP client config.',
        );
      return response;
    } finally {
      release();
    }
  };

  /** Requests GitHub last said were left, per rate-limit resource (core, graphql, search). */
  const remaining = () => structuredClone(capacity);

  return { fetcher, remaining };
}

export type Transport = ReturnType<typeof createTransport>;
