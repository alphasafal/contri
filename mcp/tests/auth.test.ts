import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createAuth, looksLikePlaceholder, type Fetcher } from '../src/auth';
import { json } from '../../tests/unit/helpers';

const SIGNED_IN = 'gho_' + 'SignedIn01'.repeat(4);
const OLD = 'gho_' + 'OldToken01'.repeat(4);
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
      return json(approved ? { access_token: SIGNED_IN } : { error: 'authorization_pending' });
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
      '\u201cgithub_pat_11ABCDEFG0123456789abcdefghij\u201d', // pasted with smart quotes
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
    // A file left from before with loose permissions must not expose the new token.
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, '{}', { mode: 0o644 });
    let t = 1_000_000;
    const flow = fakeDeviceFlow();
    const auth = createAuth({ env: {}, file, fetcher: flow.fetcher, now: () => t });
    expect(auth.status().note).toMatch(/Offer the user sign_in/);

    const started = await auth.startSignIn();
    expect(started).toMatchObject({
      signedIn: false,
      signInPending: { code: 'WDJB-MJHT', url: 'https://github.com/login/device' },
    });
    expect(await auth.poll()).toBe('pending');
    expect(auth.signedIn()).toBe(false);

    flow.approve();
    // Asked again before GitHub's 5-second interval: answered locally, GitHub is not polled.
    const asked = flow.calls.length;
    expect(await auth.poll()).toBe('pending');
    expect(flow.calls.length).toBe(asked);
    t += 5_000;
    expect(await auth.poll()).toBe('signed-in');
    expect(auth.token()).toBe(SIGNED_IN);
    expect(auth.status()).toMatchObject({ signedIn: true, login: 'safal' });
    expect(JSON.parse(readFileSync(file, 'utf8'))).toMatchObject({ token: SIGNED_IN, login: 'safal' });
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(readdirSync(dirname(file))).toEqual(['mcp-credentials.json']); // no temp file left behind

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
    writeFileSync(file, JSON.stringify({ token: OLD, login: 'safal' }));
    const auth = createAuth({ env: {}, file });
    expect(auth.status()).toMatchObject({ signedIn: true, login: 'safal' });
    auth.reject(OLD);
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

  it('never treats a real token format as a placeholder, even with words like _here inside', () => {
    const fineGrained = 'github_pat_11AAAAAAA0' + '_here_'.padEnd(20, 'x') + 'Z'.repeat(52);
    expect(looksLikePlaceholder(fineGrained)).toBe(false);
    expect(looksLikePlaceholder('gho_' + 'paste_'.padEnd(36, 'a'))).toBe(true); // underscore breaks the format
    expect(looksLikePlaceholder('gho_' + 'Ab1'.repeat(12))).toBe(false);
  });

  it('a sign-out during the final lookup is not undone, and nothing is saved', async () => {
    const file = tempFile();
    let releaseUser!: () => void;
    const fetcher: Fetcher = async (url) => {
      if (url.endsWith('/login/device/code'))
        return json({ device_code: 'd', user_code: 'C-1', verification_uri: 'https://github.com/login/device' });
      if (url.endsWith('/login/oauth/access_token')) return json({ access_token: 'gho_late' });
      await new Promise<void>((r) => (releaseUser = r)); // /user lookup is slow
      return json({ login: 'safal' });
    };
    const auth = createAuth({ env: {}, file, fetcher });
    await auth.startSignIn();
    const polled = auth.poll();
    await new Promise((r) => setTimeout(r, 0));
    expect(auth.signedIn()).toBe(true); // signed in before the lookup finishes
    auth.signOut();
    releaseUser();
    await polled;
    expect(auth.signedIn()).toBe(false);
    expect(existsSync(file)).toBe(false);
  });

  it('sign_in while a sign-in is finishing, or twice at once, never asks GitHub for a second code', async () => {
    const codes: string[] = [];
    let releaseUser!: () => void;
    const fetcher: Fetcher = async (url) => {
      if (url.endsWith('/login/device/code')) {
        codes.push('x');
        return json({
          device_code: 'd',
          user_code: `C-${codes.length}`,
          verification_uri: 'https://github.com/login/device',
        });
      }
      if (url.endsWith('/login/oauth/access_token')) return json({ access_token: 'gho_ok' });
      await new Promise<void>((r) => (releaseUser = r));
      return json({ login: 'safal' });
    };
    const auth = createAuth({ env: {}, file: tempFile(), fetcher });
    await Promise.all([auth.startSignIn(), auth.startSignIn()]);
    expect(codes).toHaveLength(1);
    const polled = auth.poll();
    await new Promise((r) => setTimeout(r, 0));
    expect(await auth.startSignIn()).toMatchObject({ signedIn: true });
    expect(codes).toHaveLength(1);
    releaseUser();
    await polled;
    expect(auth.status()).toMatchObject({ signedIn: true, login: 'safal' });
  });

  it('a rejected GITHUB_TOKEN falls back to a saved sign-in; an unusable saved file is removed', () => {
    const file = tempFile();
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify({ token: 'gho_' + 'Ab1'.repeat(12), login: 'safal' }));
    const auth = createAuth({ env: { GITHUB_TOKEN: REAL }, file });
    auth.reject(REAL);
    expect(auth.status()).toMatchObject({ signedIn: true, login: 'safal' });
    expect(auth.status().note).toMatch(/using your saved sign-in/);

    writeFileSync(file, JSON.stringify({ token: '\u201cgho_smartquotes0000000000000000000\u201d' }));
    const broken = createAuth({ env: {}, file });
    expect(broken.signedIn()).toBe(false);
    expect(existsSync(file)).toBe(false);
    expect(broken.status().note).toMatch(/unreadable, so it was removed/);
  });
});
