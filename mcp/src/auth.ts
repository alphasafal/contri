import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { CONTRI_OAUTH_CLIENT_ID } from '../../src/shared/config';

/**
 * Who CONTRI talks to GitHub as. In order:
 *
 * 1. `GITHUB_TOKEN` / `GH_TOKEN` from the MCP client config (placeholders are ignored).
 * 2. A sign-in saved earlier with the `sign_in` tool.
 * 3. Nobody: anonymous, 60 requests an hour.
 *
 * `sign_in` uses the same OAuth App and device flow as the extension: no secret,
 * no scopes (public, read-only), the user approves a short code on github.com.
 * A token GitHub rejects is dropped and CONTRI carries on anonymously, so one bad
 * config value never breaks every tool.
 */

export type Source = 'env' | 'saved' | 'sign-in';
export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

type Pending = {
  deviceCode: string;
  userCode: string;
  uri: string;
  interval: number;
  expiresAt: number;
  remember: boolean;
  /** When GitHub was last asked; polls closer together than `interval` are answered locally. */
  lastPollAt: number;
};
type Saved = { token: string; login?: string; savedAt: string };
type PollResult = 'pending' | 'signed-in' | 'expired' | 'denied' | 'error' | 'idle';

export const defaultCredentialsPath = (env: NodeJS.ProcessEnv = process.env) =>
  env.CONTRI_MCP_CREDENTIALS ||
  join(env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'contri', 'mcp-credentials.json');

/** GitHub's token formats: classic and OAuth (`gho_`, `ghp_`…) and fine-grained (`github_pat_`). */
const REAL_TOKEN = /^(?:gh[opsur]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{60,})$/;

/** Values people leave in config files by mistake: "PASTE_YOUR_TOKEN_HERE", "github_pat_...", "<token>". */
export function looksLikePlaceholder(value: string) {
  if (REAL_TOKEN.test(value)) return false;
  // Anything outside printable ASCII (smart quotes from a word processor) could never be sent
  // in a header either, so it is treated as unusable rather than failing every request later.
  return /\s|\.\.\.|[<>]|paste_|your_|_here|^x+$/i.test(value) || !/^[\x21-\x7e]+$/.test(value) || value.length < 20;
}

export function createAuth(options: {
  env?: NodeJS.ProcessEnv;
  file?: string;
  fetcher?: Fetcher;
  clientId?: string;
  /** Poll GitHub in the background after sign_in starts. Off in tests, which call poll() directly. */
  autoPoll?: boolean;
  now?: () => number;
}) {
  const env = options.env ?? process.env;
  const file = options.file ?? defaultCredentialsPath(env);
  const fetcher: Fetcher = options.fetcher ?? ((url, init) => fetch(url, init));
  const clientId = options.clientId ?? CONTRI_OAUTH_CLIENT_ID;
  const now = options.now ?? Date.now;

  let token: string | undefined;
  let source: Source | undefined;
  let login: string | undefined;
  let pending: Pending | undefined;
  let problem: string | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  /** Bumped by sign-in and sign-out, so an answer that arrives late cannot undo either. */
  let epoch = 0;
  let polling: Promise<PollResult> | undefined;
  let starting: Promise<ReturnType<typeof status>> | undefined;

  /** Reads the saved sign-in; a damaged or unusable file is removed instead of breaking every request. */
  function loadSaved() {
    let saved: Saved;
    try {
      saved = JSON.parse(readFileSync(file, 'utf8')) as Saved;
    } catch {
      return false; // no saved sign-in
    }
    if (typeof saved.token !== 'string' || looksLikePlaceholder(saved.token)) {
      forget();
      problem = 'The saved sign-in was unreadable, so it was removed. Use sign_in to sign in again.';
      return false;
    }
    token = saved.token;
    source = 'saved';
    login = saved.login;
    return true;
  }

  const configured = (env.GITHUB_TOKEN || env.GH_TOKEN || '').trim();
  if (configured && looksLikePlaceholder(configured))
    problem = 'GITHUB_TOKEN in your MCP config looks like a placeholder, so it was ignored.';
  else if (configured) {
    token = configured;
    source = 'env';
  }
  if (!token) loadSaved();

  /** Written to a new private file and moved into place, so the token is never readable by others, even briefly. */
  function save(value: string, who?: string) {
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    const temp = `${file}.${process.pid}.tmp`;
    rmSync(temp, { force: true });
    try {
      writeFileSync(temp, JSON.stringify({ token: value, login: who, savedAt: new Date(now()).toISOString() }), {
        mode: 0o600,
        flag: 'wx',
      });
      renameSync(temp, file);
    } catch (error) {
      rmSync(temp, { force: true });
      throw error;
    }
  }

  function forget() {
    rmSync(file, { force: true });
  }

  async function identify(value: string) {
    try {
      const response = await fetcher('https://api.github.com/user', {
        headers: {
          Authorization: `Bearer ${value}`,
          Accept: 'application/vnd.github+json',
          'User-Agent': 'contri-mcp',
        },
        signal: AbortSignal.timeout(18_000),
      });
      return response.ok ? (((await response.json()) as { login?: string }).login ?? undefined) : undefined;
    } catch {
      return undefined;
    }
  }

  async function postForm<T>(url: string, body: Record<string, string>): Promise<T> {
    const response = await fetcher(url, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'contri-mcp',
      },
      body: new URLSearchParams(body).toString(),
      signal: AbortSignal.timeout(18_000),
    });
    if (!response.ok) throw new Error(`GitHub sign-in is unavailable right now (${response.status}).`);
    return (await response.json()) as T;
  }

  function schedule() {
    if (!options.autoPoll || !pending) return;
    clearTimeout(timer);
    timer = setTimeout(() => void poll().then(schedule, schedule), pending.interval * 1000 + 250);
    timer.unref?.();
  }

  /**
   * One check with GitHub, at most once per GitHub's interval (calls in between are answered
   * locally). The background loop calls it on that interval; sign_in calls it too.
   */
  function poll(): Promise<PollResult> {
    // One check at a time: the background loop and sign_in share it.
    polling ??= pollOnce().finally(() => (polling = undefined));
    return polling;
  }

  async function pollOnce(): Promise<PollResult> {
    const state = pending;
    if (!state) return token ? 'signed-in' : 'idle';
    if (now() > state.expiresAt) {
      pending = undefined;
      problem = 'The sign-in code expired before it was approved. Call sign_in again for a new code.';
      return 'expired';
    }
    // Asking more often than GitHub's interval earns "slow_down" and a longer wait for everyone.
    if (now() - state.lastPollAt < state.interval * 1000) return 'pending';
    state.lastPollAt = now();
    let result: { access_token?: string; error?: string; interval?: number };
    try {
      result = await postForm('https://github.com/login/oauth/access_token', {
        client_id: clientId,
        device_code: state.deviceCode,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      });
    } catch {
      return 'pending'; // a network blip: try again on the next interval
    }
    if (pending !== state) return token ? 'signed-in' : 'idle';
    if (result.access_token) {
      // Signed in from this moment on, so a sign_in call during the lookup below says so
      // instead of starting a second code.
      const mine = ++epoch;
      pending = undefined;
      token = result.access_token;
      source = 'sign-in';
      login = undefined;
      problem = undefined;
      const who = await identify(result.access_token);
      if (mine !== epoch) return token ? 'signed-in' : 'idle'; // signed out (or in again) meanwhile
      login = who;
      if (state.remember) {
        try {
          save(result.access_token, who);
          source = 'saved';
        } catch {
          problem =
            'Signed in, but the sign-in could not be saved on this computer; it lasts until the server restarts.';
        }
      }
      return 'signed-in';
    }
    switch (result.error) {
      case 'authorization_pending':
        return 'pending';
      case 'slow_down':
        state.interval = Math.max(state.interval + 5, result.interval ?? 0);
        return 'pending';
      case 'expired_token':
        pending = undefined;
        problem = 'The sign-in code expired before it was approved. Call sign_in again for a new code.';
        return 'expired';
      case 'access_denied':
        pending = undefined;
        problem = 'Sign-in was cancelled on GitHub.';
        return 'denied';
      default:
        pending = undefined;
        problem = `GitHub could not complete sign-in${result.error ? ` (${result.error})` : ''}. Use a GITHUB_TOKEN instead, or try again later.`;
        return 'error';
    }
  }

  function status() {
    if (token)
      return {
        signedIn: true,
        ...(login ? { login } : {}),
        via:
          source === 'env'
            ? 'GITHUB_TOKEN in the MCP config'
            : source === 'saved'
              ? `sign-in saved on this computer (${file})`
              : 'sign-in for this session',
        ...(problem ? { note: problem } : {}),
      };
    if (pending)
      return {
        signedIn: false,
        signInPending: {
          code: pending.userCode,
          url: pending.uri,
          expiresAt: new Date(pending.expiresAt).toISOString(),
        },
        note: `Waiting for approval: open ${pending.uri} and enter ${pending.userCode}.`,
      };
    return {
      signedIn: false,
      note: `${problem ? `${problem} ` : ''}Anonymous: 60 GitHub requests an hour. Offer the user sign_in (they approve a code on github.com) for 5,000.`,
    };
  }

  return {
    token: () => token,
    signedIn: () => Boolean(token),
    status,
    poll,

    /** GitHub said 401 for this token: stop using it and carry on anonymously. */
    reject(value: string) {
      if (value !== token) return;
      const from = source;
      token = undefined;
      login = undefined;
      source = undefined;
      if (from === 'saved') forget();
      if (from === 'env' && loadSaved()) {
        problem =
          'GitHub rejected GITHUB_TOKEN from your MCP config, so CONTRI is using your saved sign-in instead. Fix or remove it in the config.';
        return;
      }
      problem =
        from === 'env'
          ? 'GitHub rejected GITHUB_TOKEN from your MCP config (expired, revoked or mistyped), so CONTRI is anonymous for now. Fix it in the config, or use sign_in.'
          : 'GitHub rejected the saved sign-in (it was revoked), so CONTRI is anonymous for now. Use sign_in to sign in again.';
    },

    startSignIn(remember = true) {
      starting ??= begin(remember).finally(() => (starting = undefined));
      return starting;
    },

    signOut() {
      epoch++;
      clearTimeout(timer);
      pending = undefined;
      const fromEnv = source === 'env';
      forget();
      if (!fromEnv) {
        token = undefined;
        login = undefined;
        source = undefined;
      }
      problem = fromEnv ? 'Signed in with GITHUB_TOKEN from the MCP config: remove it there to sign out.' : undefined;
      return status();
    },
  };

  async function begin(remember: boolean) {
    if (!clientId) throw new Error('This build has no GitHub sign-in configured. Set GITHUB_TOKEN instead.');
    if (token) return status();
    if (pending && now() < pending.expiresAt) return status();
    const mine = epoch;
    const result = await postForm<{
      device_code?: string;
      user_code?: string;
      verification_uri?: string;
      expires_in?: number;
      interval?: number;
      error_description?: string;
    }>('https://github.com/login/device/code', { client_id: clientId, scope: '' });
    if (!result.device_code || !result.user_code)
      throw new Error(result.error_description || 'GitHub did not start sign-in. Try again.');
    if (mine !== epoch || token) return status(); // signed in or out while GitHub answered
    pending = {
      deviceCode: result.device_code,
      userCode: result.user_code,
      uri: result.verification_uri ?? 'https://github.com/login/device',
      interval: Math.max(5, result.interval ?? 5),
      expiresAt: now() + (result.expires_in ?? 900) * 1000,
      remember,
      lastPollAt: 0,
    };
    problem = undefined;
    schedule();
    return status();
  }
}

export type Auth = ReturnType<typeof createAuth>;
