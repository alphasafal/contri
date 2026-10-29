import { useEffect, useRef, useState, type FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import type { DeviceStart } from '../background/auth';
import { call, type ConnectionInfo, type Prefs } from '../shared/protocol';
import { REPO_URL, WEBSITE_URL } from '../shared/config';
import { safeHref } from '../shared/repo';
import { ExternalIcon, Wordmark } from '../content/ui/icons';
import '../content/widget.css';
import './settings.css';

function DeviceSignIn({ remember, onConnected }: { remember: boolean; onConnected: (c: ConnectionInfo) => void }) {
  const [flow, setFlow] = useState<DeviceStart | null>(null);
  const [status, setStatus] = useState('');
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  const poll = (interval: number) => {
    timer.current = setTimeout(async () => {
      try {
        const result = await call('devicePoll', { remember });
        if (result.status === 'connected') {
          setFlow(null);
          setStatus('Signed in. Return to GitHub — CONTRI now has 5,000 requests per hour.');
          onConnected({ ...result.connection, capacity: {} });
        } else if (result.status === 'pending' || result.status === 'slow_down') poll(result.interval);
        else {
          setFlow(null);
          setStatus(
            result.status === 'error'
              ? result.message
              : result.status === 'denied'
                ? 'Sign-in was cancelled on GitHub.'
                : 'The code expired. Start again.',
          );
        }
      } catch (e) {
        setFlow(null);
        setStatus((e as Error).message);
      }
    }, interval * 1000);
  };

  const start = async () => {
    setStatus('');
    try {
      const start = await call('deviceStart', {});
      const value = { ...start, verificationUri: safeHref(start.verificationUri) ?? 'https://github.com/login/device' };
      setFlow(value);
      poll(value.interval);
      window.open(value.verificationUri, '_blank', 'noopener');
    } catch (e) {
      setStatus((e as Error).message);
    }
  };

  return (
    <div className="cc-device">
      {!flow ? (
        <button className="cc-primary" onClick={() => void start()}>
          Sign in with GitHub
        </button>
      ) : (
        <>
          <p>Enter this code on the GitHub page that just opened:</p>
          <div className="cc-code" aria-live="polite">
            {flow.userCode}
          </div>
          <div className="cc-row-actions">
            <button
              className="cc-secondary"
              onClick={() =>
                void navigator.clipboard.writeText(flow.userCode).then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                })
              }
            >
              {copied ? 'Copied' : 'Copy code'}
            </button>
            <a className="cc-secondary" href={flow.verificationUri} target="_blank" rel="noreferrer">
              Open github.com/login/device <ExternalIcon size={11} />
            </a>
          </div>
          <p className="cc-small">Waiting for you to approve… CONTRI only asks for public, read-only access.</p>
        </>
      )}
      {status && (
        <p role="status" className="cc-note cc-note-info">
          {status}
        </p>
      )}
    </div>
  );
}

function TokenForm({ remember, onConnected }: { remember: boolean; onConnected: (c: ConnectionInfo) => void }) {
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMessage('');
    try {
      const connection = await call('connect', { token, remember });
      setToken('');
      // The page switches to its connected state, which replaces this form.
      onConnected({ ...connection, capacity: {} });
    } catch (err) {
      setMessage((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit}>
      <ol>
        <li>
          <a
            href="https://github.com/settings/personal-access-tokens/new?name=CONTRI&description=Read%20public%20repository%20evidence&expires_in=30"
            target="_blank"
            rel="noreferrer"
          >
            Create a fine-grained token on GitHub <ExternalIcon size={11} />
          </a>{' '}
          with your account as owner and a 30-day expiry.
        </li>
        <li>
          Choose <strong>Public repositories</strong>. Leave every permission at <strong>No access</strong>.
        </li>
        <li>Generate it, copy it, and paste it here.</li>
      </ol>
      <label htmlFor="token">GitHub token</label>
      <input
        id="token"
        type="password"
        autoComplete="off"
        spellCheck={false}
        value={token}
        onChange={(e) => setToken(e.target.value)}
        placeholder="github_pat_…"
        required
        maxLength={512}
      />
      <button className="cc-primary" disabled={busy || !token.trim()}>
        {busy ? 'Validating…' : 'Connect token'}
      </button>
      {message && (
        <p role="status" className="cc-note cc-note-info">
          {message}
        </p>
      )}
    </form>
  );
}

function Preferences() {
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  useEffect(() => {
    void call('prefs', {}).then(setPrefs);
  }, []);
  const [problem, setProblem] = useState('');
  if (!prefs) return null;
  const update = (change: Partial<Prefs>) =>
    void call('setPrefs', change)
      .then((next) => {
        setPrefs(next);
        setProblem('');
      })
      .catch((e: Error) => setProblem(`Could not save: ${e.message}`));
  return (
    <section>
      <h2>On GitHub</h2>
      {problem && (
        <p className="cc-note" role="alert">
          {problem}
        </p>
      )}
      <label htmlFor="widget">When I open a repository</label>
      <select id="widget" value={prefs.widget} onChange={(e) => update({ widget: e.target.value as Prefs['widget'] })}>
        <option value="launcher">Show the small CONTRI button (recommended)</option>
        <option value="issues">Open CONTRI automatically on issue pages</option>
        <option value="open">Always open CONTRI</option>
      </select>
      <label htmlFor="badges">Inline badges next to issue titles and in the About sidebar</label>
      <select id="badges" value={prefs.badges} onChange={(e) => update({ badges: e.target.value as Prefs['badges'] })}>
        <option value="smart">Check automatically when signed in, on click otherwise</option>
        <option value="always">Always check automatically</option>
        <option value="click">Only when I click a badge</option>
        <option value="off">Don&apos;t show badges</option>
      </select>
      <label className="cc-inline">
        <input
          type="checkbox"
          checked={prefs.notifications}
          onChange={(e) => update({ notifications: e.target.checked })}
        />
        Notify me when a watched issue changes
      </label>
    </section>
  );
}

/** Opened from the install flow (settings.html?welcome=1). */
const WELCOME = new URLSearchParams(location.search).has('welcome');

function Settings() {
  const [status, setStatus] = useState<ConnectionInfo | null>(null);
  const [remember, setRemember] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    void call('connection', {})
      .then(setStatus)
      .catch((e: Error) => setMessage(e.message));
  }, []);

  const core = status?.capacity?.graphql ?? status?.capacity?.core;

  return (
    <main className="cc-settings">
      <header>
        <Wordmark size={26} />
        <a className="cc-site" href={WEBSITE_URL} target="_blank" rel="noreferrer">
          contri-two.vercel.app <ExternalIcon size={11} />
        </a>
      </header>
      <h1>{status?.connected ? 'You’re connected.' : WELCOME ? 'Welcome to CONTRI.' : 'A clearer connection.'}</h1>
      <p>
        CONTRI reads public GitHub evidence to show whether a project is active, whether the team replies, and whether
        an issue is already taken. Signing in raises GitHub&apos;s limit from 60 to 5,000 requests per hour and unlocks
        faster checks.
      </p>
      <p className="cc-status">
        {status?.connected
          ? `Signed in${status.login ? ` as @${status.login}` : ''} · ${status.method === 'oauth' ? 'GitHub sign-in' : 'token'} · ${
              status.remembered ? 'remembered on this device' : 'until the browser closes'
            }`
          : 'Anonymous mode · 60 requests per hour'}
        {core?.remaining !== undefined ? ` · ${core.remaining.toLocaleString()} requests left` : ''}
      </p>

      {!status?.connected && (
        <section>
          <label className="cc-inline">
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
            Stay signed in on this device
          </label>
          <p className="cc-small">
            By default the sign-in is kept in memory and forgotten when the browser closes. Remembering stores it
            encrypted (AES-GCM) in extension storage that GitHub pages cannot read.
          </p>
          {status?.oauthAvailable ? (
            <>
              <DeviceSignIn remember={remember} onConnected={setStatus} />
              <details>
                <summary>Use a personal access token instead</summary>
                <TokenForm remember={remember} onConnected={setStatus} />
              </details>
            </>
          ) : (
            <>
              <h2>Connect with a personal access token</h2>
              <TokenForm remember={remember} onConnected={setStatus} />
            </>
          )}
        </section>
      )}

      {status?.connected && status.invalid && (
        <p role="alert" className="cc-note cc-note-warn">
          GitHub rejected this sign-in: it expired or was revoked. Sign out, then connect again.
        </p>
      )}

      {status?.connected && (
        <button
          className="cc-secondary"
          onClick={() =>
            void call('disconnect', {})
              .then((c) => {
                setStatus({ ...c, capacity: {} });
                setMessage('Signed out. CONTRI is back in anonymous mode.');
              })
              .catch((e: Error) => setMessage(e.message))
          }
        >
          Sign out
        </button>
      )}

      <Preferences />

      <section>
        <h2>Data</h2>
        <button
          className="cc-secondary"
          onClick={() =>
            void call('refresh', {})
              .then(() => setMessage('Cached reports cleared. Your shortlist and watched issues are kept.'))
              .catch((e: Error) => setMessage(e.message))
          }
        >
          Clear cached reports
        </button>
        {message && (
          <p role="status" className="cc-note cc-note-info">
            {message}
          </p>
        )}
        <p className="cc-small">
          Public repositories only · no analytics · no backend · AI summaries run on your device.{' '}
          <a href={WEBSITE_URL} target="_blank" rel="noreferrer">
            Website <ExternalIcon size={11} />
          </a>{' '}
          ·{' '}
          <a href={`${REPO_URL}/blob/main/PRIVACY.md`} target="_blank" rel="noreferrer">
            Privacy details <ExternalIcon size={11} />
          </a>{' '}
          ·{' '}
          <a href="https://github.com/settings/applications" target="_blank" rel="noreferrer">
            Review or revoke access on GitHub <ExternalIcon size={11} />
          </a>
        </p>
      </section>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<Settings />);
