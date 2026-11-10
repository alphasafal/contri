import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installChrome, json } from './helpers';
import { validateMessage } from '../../src/background/validation';
import { buildBrief, normalizeSaved } from '../../src/core/brief';
import { createShortlistStore } from '../../src/core/shortlist';
import { addWatched, describeChange, WATCH_LIMIT } from '../../src/background/watch';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
  vi.unstubAllEnvs();
});

describe('message validation', () => {
  it('blocks credential operations from GitHub pages', () => {
    expect(() => validateMessage({ op: 'connect', input: { token: 'x', remember: false } }, false)).toThrow(
      /not allowed/,
    );
    expect(() => validateMessage({ op: 'deviceStart', input: {} }, false)).toThrow(/not allowed/);
    expect(validateMessage({ op: 'deviceStart', input: {} }, true).op).toBe('deviceStart');
  });
  it('rejects malformed report requests', () => {
    expect(() => validateMessage({ op: 'overview', input: { repo: 'not a repo' } }, false)).toThrow(/repository/);
    expect(() => validateMessage({ op: 'insight', input: { repo: 'a/b', number: 0 } }, false)).toThrow();
    expect(() =>
      validateMessage(
        {
          op: 'issues',
          input: { repo: 'a/b', label: 'is:closed', query: '', unassigned: false, sort: 'updated', page: 1 },
        },
        false,
      ),
    ).toThrow();
    expect(() => validateMessage({ op: 'nuke', input: {} }, false)).toThrow(/not allowed/);
    expect(() => validateMessage({ op: 'repo', input: { repo: 'a/b' }, force: 'yes' }, false)).toThrow();
  });
  it('accepts an issue list of 1 to 30 distinct numbers and nothing else', () => {
    expect(validateMessage({ op: 'insights', input: { repo: 'a/b', numbers: [3, 1, 2] } }, false).op).toBe('insights');
    expect(() => validateMessage({ op: 'insights', input: { repo: 'a/b', numbers: [] } }, false)).toThrow();
    expect(() => validateMessage({ op: 'insights', input: { repo: 'a/b', numbers: [1, 1] } }, false)).toThrow();
    expect(() => validateMessage({ op: 'insights', input: { repo: 'a/b', numbers: [0] } }, false)).toThrow();
    expect(() => validateMessage({ op: 'insights', input: { repo: 'a/b', numbers: ['1'] } }, false)).toThrow();
    expect(() => validateMessage({ op: 'insights', input: { repo: 'a/b', numbers: '1,2' } }, false)).toThrow();
    expect(() =>
      validateMessage(
        { op: 'insights', input: { repo: 'a/b', numbers: Array.from({ length: 31 }, (_, i) => i + 1) } },
        false,
      ),
    ).toThrow();
    expect(() => validateMessage({ op: 'insights', input: { repo: 'nope', numbers: [1] } }, false)).toThrow(
      /repository/,
    );
  });
  it('lets pages change only the widget mode and position', () => {
    expect(validateMessage({ op: 'setPrefs', input: { position: { x: 10, y: 20 } } }, false).op).toBe('setPrefs');
    expect(() => validateMessage({ op: 'setPrefs', input: { notifications: false } }, false)).toThrow(/not allowed/);
    expect(validateMessage({ op: 'setPrefs', input: { badges: 'off', notifications: false } }, true).op).toBe(
      'setPrefs',
    );
  });
  it('normalizes cache flags', () => {
    expect(validateMessage({ op: 'repo', input: { repo: 'a/b' }, cacheOnly: true }, false)).toMatchObject({
      force: false,
      cacheOnly: true,
    });
  });
});

describe('shortlist and brief', () => {
  it('only saves github.com repository and issue URLs', () => {
    expect(normalizeSaved({ repo: 'a/b', url: 'https://github.com/a/b/issues/3?x=1', title: 't', note: '' }).url).toBe(
      'https://github.com/a/b/issues/3',
    );
    expect(() => normalizeSaved({ repo: 'a/b', url: 'https://evil.com/a/b', title: '', note: '' })).toThrow();
    expect(() => normalizeSaved({ repo: 'a/b', url: 'https://github.com/c/d', title: '', note: '' })).toThrow();
  });
  it('serializes concurrent saves and keeps notes unless asked', async () => {
    let rows: Array<{ repo: string; url: string; title: string; note: string }> = [];
    const store = createShortlistStore(
      async () => rows,
      async (next) => {
        rows = next;
      },
    );
    await store.save({ repo: 'a/b', url: 'https://github.com/a/b', title: 'a/b', note: 'keep me' }, true);
    await Promise.all([
      store.save({ repo: 'a/b', url: 'https://github.com/a/b', title: 'a/b', note: '' }),
      store.save({ repo: 'a/b', url: 'https://github.com/a/b/issues/1', title: '#1', note: '' }),
    ]);
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.url.endsWith('/a/b'))?.note).toBe('keep me');
  });
  it('builds a brief with evidence and untrusted-content guidance', () => {
    const brief = buildBrief(
      { repo: 'a/b', title: 'Crash', number: 4, url: 'https://github.com/a/b/issues/4' },
      'explain',
      {
        linkState: 'clear',
        claim: { state: 'stale', assignees: [], note: 'Claim is quiet' },
        digest: '- point one',
      },
    );
    expect(brief).toContain('No linked open PR found');
    expect(brief).toContain('Claim status: stale');
    expect(brief).toContain('- point one');
    expect(brief).toMatch(/untrusted evidence/);
  });
});

describe('watch list', () => {
  const base = { state: 'open', assignees: ['kim'], openPrs: 0, claim: 'assigned' as const };
  it('reports useful changes only', () => {
    expect(describeChange(undefined, base)).toBeNull();
    expect(describeChange(base, { ...base, assignees: [], claim: 'none' })).toMatch(/unassigned/);
    expect(describeChange({ ...base, assignees: [] }, { ...base, assignees: [], openPrs: 1 })).toMatch(/pull request/);
    expect(describeChange(base, { ...base, state: 'closed' })).toMatch(/closed/);
    expect(describeChange(base, base)).toBeNull();
  });
  it('limits anonymous watching and ignores duplicates', () => {
    let list = addWatched([], { repo: 'a/b', number: 1, title: 'one' }, WATCH_LIMIT.anonymous);
    list = addWatched(list, { repo: 'a/b', number: 1, title: 'one' }, WATCH_LIMIT.anonymous);
    expect(list).toHaveLength(1);
    list = addWatched(list, { repo: 'a/b', number: 2, title: 'two' }, WATCH_LIMIT.anonymous);
    list = addWatched(list, { repo: 'a/b', number: 3, title: 'three' }, WATCH_LIMIT.anonymous);
    expect(() => addWatched(list, { repo: 'a/b', number: 4, title: 'four' }, WATCH_LIMIT.anonymous)).toThrow(/Sign in/);
  });
});

describe('sign-in', () => {
  beforeEach(() => installChrome());

  it('keeps a token for the session only unless remembered', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ login: 'safal' })),
    );
    const auth = await import('../../src/background/auth');
    const result = await auth.connect('github_pat_123', false);
    expect(result).toMatchObject({ connected: true, remembered: false, login: 'safal', method: 'token' });
    const chrome = globalThis.chrome as unknown as ReturnType<typeof installChrome>;
    expect(chrome.storage.session.dump().githubCredential).toBe('github_pat_123');
    expect(chrome.storage.local.dump().githubCredential).toBeUndefined();
    expect(chrome.storage.local.setAccessLevel).toHaveBeenCalledWith({ accessLevel: 'TRUSTED_CONTEXTS' });
    await auth.disconnect();
    expect(await auth.getToken()).toBeUndefined();
  });

  it('keeps a remembered token in exactly one storage area', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ login: 'safal' })),
    );
    const auth = await import('../../src/background/auth');
    const chrome = globalThis.chrome as unknown as ReturnType<typeof installChrome>;
    await auth.connect('github_pat_session', false);
    await auth.connect('github_pat_remembered', true);
    // Remembered credentials are stored encrypted, never in plain text.
    expect(chrome.storage.local.dump().githubCredential).toMatchObject({ v: 1 });
    expect(JSON.stringify(chrome.storage.local.dump())).not.toContain('github_pat_remembered');
    expect(await auth.getToken()).toBe('github_pat_remembered');
    expect(chrome.storage.session.dump().githubCredential).toBeUndefined();
    await auth.connect('github_pat_session2', false);
    expect(chrome.storage.session.dump().githubCredential).toBe('github_pat_session2');
    expect(chrome.storage.local.dump().githubCredential).toBeUndefined();
    expect(await auth.connection()).toMatchObject({ remembered: false, connected: true });
  });

  it('a remembered sign-in survives a worker restart and decrypts', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ login: 'safal' })),
    );
    const first = await import('../../src/background/auth');
    await first.connect('github_pat_keep', true);
    vi.resetModules(); // a new service worker: in-memory state is gone, storage and IndexedDB remain
    const restarted = await import('../../src/background/auth');
    expect(await restarted.getToken()).toBe('github_pat_keep');
    expect(await restarted.connection()).toMatchObject({ remembered: true, login: 'safal' });
  });

  it('signs out cleanly when the encrypted credential cannot be decrypted', async () => {
    const chrome = globalThis.chrome as unknown as ReturnType<typeof installChrome>;
    await chrome.storage.local.set({
      githubCredential: { v: 1, iv: 'AAAAAAAAAAAAAAAA', data: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==' },
      githubCredentialMeta: { login: 'safal', method: 'token' },
    });
    const auth = await import('../../src/background/auth');
    expect(await auth.connection()).toMatchObject({ connected: false, remembered: false });
    expect(chrome.storage.local.dump().githubCredential).toBeUndefined();
  });

  it('removes the duplicate session copy left by 0.3.0 and survives a restart', async () => {
    const chrome = globalThis.chrome as unknown as ReturnType<typeof installChrome>;
    const meta = { login: 'safal', method: 'token' };
    await chrome.storage.local.set({ githubCredential: 'tok', githubCredentialMeta: meta });
    await chrome.storage.session.set({ githubCredential: 'tok', githubCredentialMeta: meta });
    const auth = await import('../../src/background/auth');
    expect(await auth.connection()).toMatchObject({ connected: true, remembered: true, login: 'safal' });
    expect(chrome.storage.session.dump().githubCredential).toBeUndefined();
    expect(await auth.getToken()).toBe('tok');
    // The 0.3.0 plain-text copy is replaced by an encrypted one.
    expect(chrome.storage.local.dump().githubCredential).toMatchObject({ v: 1 });
    expect(JSON.stringify(chrome.storage.local.dump())).not.toContain('"tok"');
  });

  it('flags a credential GitHub rejects so Settings can ask to reconnect', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ login: 'safal' })),
    );
    const auth = await import('../../src/background/auth');
    await auth.connect('revoked', true);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ message: 'Bad credentials' }, 401)),
    );
    const transport = await import('../../src/background/transport');
    await expect(transport.authenticatedFetch('https://api.github.com/repos/a/b')).rejects.toThrow(
      /expired or was revoked/,
    );
    expect(await auth.connection()).toMatchObject({ connected: true, invalid: true });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ login: 'safal' })),
    );
    await auth.connect('fresh', true);
    expect((await auth.connection()).invalid).toBe(false);
  });

  it('stops polling when GitHub reports a device-flow error it will not recover from', async () => {
    vi.stubEnv('VITE_GITHUB_CLIENT_ID', 'Iv1.test');
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url.endsWith('/login/device/code')
          ? json({ device_code: 'dc', user_code: 'ABCD-1234', expires_in: 900, interval: 5 })
          : json({ error: 'device_flow_disabled', error_description: 'Device flow must be enabled' }),
      ),
    );
    const auth = await import('../../src/background/auth');
    await auth.startDeviceFlow();
    expect(await auth.pollDeviceFlow(false)).toMatchObject({ status: 'error', message: /device_flow_disabled/ });
    expect(await auth.pollDeviceFlow(false)).toMatchObject({ status: 'idle' });
  });

  it('reports slow_down with a longer interval and an expired code as expired', async () => {
    vi.stubEnv('VITE_GITHUB_CLIENT_ID', 'Iv1.test');
    const answers = [{ error: 'slow_down', interval: 10 }, { error: 'expired_token' }];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url.endsWith('/login/device/code')
          ? json({ device_code: 'dc', user_code: 'ABCD-1234', expires_in: 900, interval: 5 })
          : json(answers.shift()),
      ),
    );
    const auth = await import('../../src/background/auth');
    await auth.startDeviceFlow();
    expect(await auth.pollDeviceFlow(false)).toEqual({ status: 'slow_down', interval: 10 });
    expect(await auth.pollDeviceFlow(false)).toEqual({ status: 'expired' });
  });

  it('rejects invalid tokens without storing them', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ message: 'Bad credentials' }, 401)),
    );
    const auth = await import('../../src/background/auth');
    await expect(auth.connect('nope', true)).rejects.toThrow(/invalid or expired/);
    expect(await auth.getToken()).toBeUndefined();
  });

  it('completes the device flow with no client secret', async () => {
    vi.stubEnv('VITE_GITHUB_CLIENT_ID', 'Iv1.test');
    const bodies: string[] = [];
    let polls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (init?.body) bodies.push(String(init.body));
        if (url.endsWith('/login/device/code'))
          return json({
            device_code: 'dc',
            user_code: 'ABCD-1234',
            verification_uri: 'https://github.com/login/device',
            expires_in: 900,
            interval: 5,
          });
        if (url.endsWith('/login/oauth/access_token'))
          return json(
            ++polls === 1 ? { error: 'authorization_pending' } : { access_token: 'gho_abc', token_type: 'bearer' },
          );
        if (url.endsWith('/user')) return json({ login: 'safal' });
        return json({}, 404);
      }),
    );
    const auth = await import('../../src/background/auth');
    const start = await auth.startDeviceFlow();
    expect(start.userCode).toBe('ABCD-1234');
    expect(await auth.pollDeviceFlow(true)).toMatchObject({ status: 'pending' });
    const done = await auth.pollDeviceFlow(true);
    expect(done).toMatchObject({
      status: 'connected',
      connection: { login: 'safal', method: 'oauth', remembered: true },
    });
    expect(bodies.join('&')).not.toMatch(/client_secret/);
    expect(bodies[0]).toContain('client_id=Iv1.test');
  });
});

describe('OAuth app configuration', () => {
  it('uses the CONTRI OAuth App by default and lets a build override or disable it', async () => {
    expect((await import('../../src/shared/config')).GITHUB_CLIENT_ID).toBe('Ov23liqTB6n54MCQKWzi');
    vi.resetModules();
    vi.stubEnv('VITE_GITHUB_CLIENT_ID', 'Ov23lifork');
    expect((await import('../../src/shared/config')).GITHUB_CLIENT_ID).toBe('Ov23lifork');
    vi.resetModules();
    vi.stubEnv('VITE_GITHUB_CLIENT_ID', 'none');
    expect((await import('../../src/shared/config')).GITHUB_CLIENT_ID).toBe('');
    vi.resetModules();
    vi.stubEnv('VITE_GITHUB_CLIENT_ID', '');
    expect((await import('../../src/shared/config')).GITHUB_CLIENT_ID).toBe('Ov23liqTB6n54MCQKWzi');
  });
});

describe('sign-in resilience', () => {
  beforeEach(() => {
    installChrome();
    vi.stubGlobal('indexedDB', new IDBFactory());
  });
  const brokenIndexedDB = () => {
    const real = globalThis.indexedDB;
    vi.stubGlobal('indexedDB', {
      open: () => {
        throw new DOMException('Internal error opening backing store', 'UnknownError');
      },
    });
    return () => vi.stubGlobal('indexedDB', real);
  };
  const plainRemembered = async () => {
    const chrome = globalThis.chrome as unknown as ReturnType<typeof installChrome>;
    await chrome.storage.local.set({
      githubCredential: 'tok',
      githubCredentialMeta: { login: 'safal', method: 'token' },
    });
    return chrome;
  };

  it('keeps a 0.3.0 sign-in working when encryption fails, and seals it once storage recovers', async () => {
    const chrome = await plainRemembered();
    const repair = brokenIndexedDB();
    const auth = await import('../../src/background/auth');
    expect(await auth.getToken()).toBe('tok');
    expect(await auth.connection()).toMatchObject({ connected: true, remembered: true });
    expect(await auth.disconnect()).toMatchObject({ connected: false });
    await plainRemembered();
    repair();
    vi.resetModules();
    const restarted = await import('../../src/background/auth');
    expect(await restarted.getToken()).toBe('tok');
    expect(chrome.storage.local.dump().githubCredential).toMatchObject({ v: 1 });
  });

  it('never deletes a remembered sign-in because IndexedDB failed for a moment', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ login: 'safal' })),
    );
    const first = await import('../../src/background/auth');
    await first.connect('github_pat_keep', true);
    const chrome = globalThis.chrome as unknown as ReturnType<typeof installChrome>;
    const repair = brokenIndexedDB();
    vi.resetModules();
    const restarted = await import('../../src/background/auth');
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    expect(await restarted.connection()).toMatchObject({ connected: false });
    expect(chrome.storage.local.dump().githubCredential).toMatchObject({ v: 1 });
    // Retries are throttled: still signed out right after, back once storage recovers 30 s later.
    repair();
    expect(await restarted.getToken()).toBeUndefined();
    vi.advanceTimersByTime(30_000);
    vi.useRealTimers();
    expect(await restarted.getToken()).toBe('github_pat_keep');
  });

  it('says plainly when a remembered sign-in cannot be saved', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ login: 'safal' })),
    );
    const auth = await import('../../src/background/auth');
    await auth.getToken();
    brokenIndexedDB();
    await expect(auth.connect('github_pat_x', true)).rejects.toThrow(/could not save the sign-in/);
    expect(await auth.connect('github_pat_x', false)).toMatchObject({ connected: true, remembered: false });
  });

  it('does not hang when IndexedDB never answers', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    vi.stubGlobal('indexedDB', { open: () => ({}) }); // a request that never fires success or error
    const vault = await import('../../src/background/vault');
    const pending = vault.unseal({ v: 1, iv: 'AAAAAAAAAAAAAAAA', data: 'AAAA' });
    const settled = expect(pending).rejects.toThrow(/did not open in time/);
    vi.advanceTimersByTime(vault.OPEN_TIMEOUT_MS);
    await settled;
    vi.useRealTimers();
  });

  it('uses one key when two sign-ins are sealed at the same moment', async () => {
    const vault = await import('../../src/background/vault');
    const [a, b] = await Promise.all([vault.seal('first'), vault.seal('second')]);
    expect(await vault.unseal(a)).toBe('first');
    expect(await vault.unseal(b)).toBe('second');
  });

  it('a late 401 for the previous token never marks the new sign-in as rejected', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ login: 'safal' })),
    );
    const auth = await import('../../src/background/auth');
    await auth.connect('old', true);
    // Make the 'rejected' write slow, so it would land after the new sign-in is stored.
    const chrome = globalThis.chrome as unknown as ReturnType<typeof installChrome>;
    const set = chrome.storage.local.set.getMockImplementation()!;
    chrome.storage.local.set.mockImplementation(async (items: Record<string, unknown>) => {
      if (!('githubCredential' in items)) await new Promise((r) => setTimeout(r, 30));
      return set(items);
    });
    await Promise.all([auth.markInvalid('old'), auth.connect('new', true)]);
    expect(await auth.connection()).toMatchObject({ connected: true, invalid: false });
    expect(await auth.getToken()).toBe('new');
    vi.resetModules();
    const restarted = await import('../../src/background/auth');
    expect(await restarted.connection()).toMatchObject({ connected: true, invalid: false });
  });

  it('clears the rejected flag when the same credential works again', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ login: 'safal' })),
    );
    const auth = await import('../../src/background/auth');
    await auth.connect('flaky', false);
    await auth.markInvalid('flaky');
    expect((await auth.connection()).invalid).toBe(true);
    const transport = await import('../../src/background/transport');
    await transport.authenticatedFetch('https://api.github.com/repos/a/b');
    await vi.waitFor(async () => expect((await auth.connection()).invalid).toBe(false));
  });
});

describe('transport', () => {
  beforeEach(() => installChrome());

  it('adds the token, tracks capacity per resource and backs off when limited', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ login: 'safal' })),
    );
    const auth = await import('../../src/background/auth');
    await auth.connect('tok', false);
    const seen: Array<string | null> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        seen.push(new Headers(init?.headers).get('Authorization'));
        return seen.length === 1
          ? json({}, 200, {
              'x-ratelimit-resource': 'graphql',
              'x-ratelimit-remaining': '4990',
              'x-ratelimit-reset': '9999999999',
            })
          : json({ message: 'limit' }, 429, {
              'x-ratelimit-remaining': '0',
              'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 600),
            });
      }),
    );
    const transport = await import('../../src/background/transport');
    await transport.authenticatedFetch('https://api.github.com/graphql');
    expect(seen[0]).toBe('Bearer tok');
    expect(transport.capacityFor('graphql').remaining).toBe(4990);
    await transport.authenticatedFetch('https://api.github.com/repos/a/b');
    await expect(transport.authenticatedFetch('https://api.github.com/repos/a/b')).rejects.toThrow(/slow down/);
    expect(seen).toHaveLength(2);
  });

  it('never runs more than two requests at once', async () => {
    let active = 0;
    let peak = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        active++;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 20));
        active--;
        return json({});
      }),
    );
    const transport = await import('../../src/background/transport');
    await Promise.all(
      Array.from({ length: 6 }, (_, i) => transport.authenticatedFetch(`https://api.github.com/x/${i}`)),
    );
    expect(peak).toBe(2);
  });
});
