import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createAuth, looksLikePlaceholder, type Fetcher } from '../src/auth';
import { json } from '../../tests/unit/helpers';

const REAL = 'github_pat_11ABCDEFG0123456789_abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOP';
const tempFile = () => join(mkdtempSync(join(tmpdir(), 'contri-auth-')), 'nested', 'mcp-credentials.json');

/** Fake github.com device flow: `approve()` makes the next poll return a token. */
function fakeDeviceFlow() {
  let approved = false;
  const calls: string[] = [];
  const fetcher: Fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push(url);
    if (url === 'https://github.com/login/device/code') {
      expect(String(init?.body)).toContain('scope=');
      return json({
        device_code: 'dev-1',
        user_code: 'WDJB-MJHT',
        verification_uri: 'https://github.com/login/device',
        expires_in: 900,
        interval: 5,
      });
    }
    if (url === 'https://github.com/login/oauth/access_token')
      return json(approved ? { access_token: 'gho_signedin' } : { error: 'authorization_pending' });
    if (url === 'https://api.github.com/user') return json({ login: 'safal' });
    return json({}, 404);
  });
  return { fetcher, calls, approve: () => (approved = true) };
}

describe('sign-in', () => {
  it('ignores placeholders but never a real token', () => {
    for (const value of [
      'PASTE_YOUR_GITHUB_TOKEN_HERE',
      'github_pat_...',
      '<token>',
      'xxxxxxxxxxxxxxxxxxxxxxxx',
      'abc',
    ])
      expect(looksLikePlaceholder(value)).toBe(true);
    expect(looksLikePlaceholder(REAL)).toBe(false);
    expect(looksLikePlaceholder('ghp_' + 'a1B2c3D4e5'.repeat(4))).toBe(false);
  });

  it('uses GITHUB_TOKEN from the config, and says when it was a placeholder', () => {
    expect(createAuth({ env: { GITHUB_TOKEN: REAL }, file: tempFile() }).status()).toMatchObject({
      signedIn: true,
      via: 'GITHUB_TOKEN in the MCP config',
    });
    const placeholder = createAuth({ env: { GITHUB_TOKEN: 'PASTE_YOUR_GITHUB_TOKEN_HERE' }, file: tempFile() });
    expect(placeholder.signedIn()).toBe(false);
    expect(placeholder.status().note).toMatch(/placeholder.*sign_in/);
  });

  it('signs in with the device flow and saves the sign-in for next time, readable only by the user', async () => {
    const file = tempFile();
    const flow = fakeDeviceFlow();
    const auth = createAuth({ env: {}, file, fetcher: flow.fetcher });
    expect(auth.status().note).toMatch(/Offer the user sign_in/);

    const started = await auth.startSignIn();
    expect(started).toMatchObject({
      signedIn: false,
      signInPending: { code: 'WDJB-MJHT', url: 'https://github.com/login/device' },
    });
    expect(await auth.poll()).toBe('pending');
    expect(auth.signedIn()).toBe(false);

    flow.approve();
    expect(await auth.poll()).toBe('signed-in');
    expect(auth.token()).toBe('gho_signedin');
    expect(auth.status()).toMatchObject({ signedIn: true, login: 'safal' });
    expect(JSON.parse(readFileSync(file, 'utf8'))).toMatchObject({ token: 'gho_signedin', login: 'safal' });
    expect(statSync(file).mode & 0o777).toBe(0o600);

    // A new server process picks the saved sign-in up.
    const next = createAuth({ env: {}, file, fetcher: flow.fetcher });
    expect(next.status()).toMatchObject({ signedIn: true, login: 'safal' });
  });

  it('keeps a session-only sign-in off the disk when remember is false', async () => {
    const file = tempFile();
    const flow = fakeDeviceFlow();
    const auth = createAuth({ env: {}, file, fetcher: flow.fetcher });
    await auth.startSignIn(false);
    flow.approve();
    await auth.poll();
    expect(auth.signedIn()).toBe(true);
    expect(existsSync(file)).toBe(false);
  });

  it('reports a denied or expired code and lets the user try again', async () => {
    let now = 0;
    const flow = fakeDeviceFlow();
    const auth = createAuth({ env: {}, file: tempFile(), fetcher: flow.fetcher, now: () => now });
    await auth.startSignIn();
    now = 901_000;
    expect(await auth.poll()).toBe('expired');
    expect(auth.status().note).toMatch(/expired.*sign_in again/);
    expect(await auth.startSignIn()).toMatchObject({ signInPending: { code: 'WDJB-MJHT' } });
  });

  it('drops a rejected saved sign-in from disk and carries on anonymously', () => {
    const file = tempFile();
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify({ token: 'gho_old', login: 'safal' }));
    const auth = createAuth({ env: {}, file });
    expect(auth.status()).toMatchObject({ signedIn: true, login: 'safal' });
    auth.reject('gho_old');
    expect(auth.signedIn()).toBe(false);
    expect(existsSync(file)).toBe(false);
    expect(auth.status().note).toMatch(/rejected the saved sign-in/);
  });

  it('a rejected GITHUB_TOKEN switches to anonymous with a clear note; sign_out forgets saved sign-ins', async () => {
    const auth = createAuth({ env: { GITHUB_TOKEN: REAL }, file: tempFile() });
    auth.reject('some-other-token');
    expect(auth.signedIn()).toBe(true);
    auth.reject(REAL);
    expect(auth.signedIn()).toBe(false);
    expect(auth.status().note).toMatch(/rejected GITHUB_TOKEN.*sign_in/);

    const file = tempFile();
    const flow = fakeDeviceFlow();
    const signedIn = createAuth({ env: {}, file, fetcher: flow.fetcher });
    await signedIn.startSignIn();
    flow.approve();
    await signedIn.poll();
    expect(existsSync(file)).toBe(true);
    expect(signedIn.signOut()).toMatchObject({ signedIn: false });
    expect(existsSync(file)).toBe(false);
  });
});
