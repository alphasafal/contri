/**
 * Node counterpart of `src/background/transport.ts`: adds the token, keeps at
 * most two GitHub requests in flight, and stops sending for a while when GitHub
 * asks it to slow down. Agents call tools in loops, so this matters more here
 * than in the browser.
 */

const MAX_CONCURRENT = 2;
const GAP_MS = 80;

export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

/** Where the token comes from: a fixed value, or the sign-in state in `auth.ts`. */
export type Credentials = { token(): string | undefined; reject(token: string): void };

export function createTransport(
  credentials: Credentials | string | undefined,
  base: Fetcher = (url, init) => fetch(url, init),
) {
  const creds: Credentials =
    typeof credentials === 'object' ? credentials : { token: () => credentials, reject: () => {} };
  let active = 0;
  const waiting: Array<() => void> = [];
  // Limits belong to an identity: anonymous use is counted per IP, a token per account.
  // Keyed by identity, signing in lifts an anonymous block straight away.
  const blockedUntil = new Map<string, number>();
  const who = (token: string | undefined) => (token ? `token:${token.slice(-8)}` : 'anonymous');

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

  const capacity = new Map<string, Record<string, { remaining: number; reset: string | null }>>();

  const block = (id: string, until: number) => {
    blockedUntil.set(id, Math.max(blockedUntil.get(id) ?? 0, until));
  };

  const fetcher: Fetcher = async (url, init = {}) => {
    // The token is only ever attached to GitHub's API host.
    if (new URL(url).origin !== 'https://api.github.com') throw new Error('CONTRI only talks to api.github.com.');
    await acquire();
    try {
      if (init.signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
      let token = creds.token();
      const until = blockedUntil.get(who(token)) ?? 0;
      if (Date.now() < until)
        throw new Error(`GitHub asked CONTRI to slow down. Try again after ${new Date(until).toLocaleTimeString()}.`);
      const headers = new Headers(init.headers);
      headers.set('User-Agent', 'contri-mcp');
      if (token) headers.set('Authorization', `Bearer ${token}`);
      let response = await base(url, { ...init, headers });
      if (response.status === 401 && token) {
        // A rejected token is dropped and the request retried anonymously, so one bad
        // config value does not break every tool. The result says how to sign in again.
        creds.reject(token);
        await response.body?.cancel().catch(() => {});
        token = undefined;
        const anonymousUntil = blockedUntil.get(who(undefined)) ?? 0;
        if (Date.now() < anonymousUntil)
          throw new Error(
            `GitHub asked CONTRI to slow down. Try again after ${new Date(anonymousUntil).toLocaleTimeString()}.`,
          );
        headers.delete('Authorization');
        response = await base(url, { ...init, headers });
      }
      const id = who(token);
      const remaining = response.headers.get('x-ratelimit-remaining');
      const reset = Number(response.headers.get('x-ratelimit-reset'));
      if (remaining !== null)
        capacity.set(id, {
          ...capacity.get(id),
          [response.headers.get('x-ratelimit-resource') ?? 'core']: {
            remaining: Number(remaining),
            reset: reset ? new Date(reset * 1000).toISOString() : null,
          },
        });
      if (response.status === 429 || (response.status === 403 && remaining === '0'))
        block(id, reset * 1000 || Date.now() + 60_000);
      const retryAfter = Number(response.headers.get('retry-after'));
      if (retryAfter > 0) block(id, Date.now() + retryAfter * 1000);
      if (response.status === 403 && remaining !== '0') {
        const body = (await response
          .clone()
          .json()
          .catch(() => ({}))) as { message?: string };
        if (/secondary rate|abuse detection/i.test(body.message ?? '')) block(id, Date.now() + 60_000);
      }
      return response;
    } finally {
      release();
    }
  };

  /** Requests GitHub last said were left for the current identity, per resource (core, graphql, search). */
  const remaining = () => structuredClone(capacity.get(who(creds.token())) ?? {});

  return { fetcher, remaining };
}

export type Transport = ReturnType<typeof createTransport>;
