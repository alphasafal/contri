import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { parseRepo } from '../../shared/repo';
import { count } from '../../shared/format';
import { call } from '../../shared/protocol';
import { Loading, Note } from './common';
import { DiscoverTab } from './DiscoverTab';
import { GlassEffect } from './GlassEffect';
import { GuideTab } from './GuideTab';
import { useRequest } from './hooks';
import { ArrowIcon, CheckIcon, CloseIcon, GearIcon, GripIcon, MinusIcon, Wordmark } from './icons';
import { IssuesTab } from './IssuesTab';
import { OverviewTab } from './OverviewTab';
import { SavedTab } from './SavedTab';
import { TeamTab } from './TeamTab';

export type Tab = 'overview' | 'team' | 'issues' | 'discover' | 'saved' | 'guide';

export type AppProps = {
  page: { repo: string | null; issue: number | null };
  onMinimize: () => void;
  onClose: () => void;
  onPositionReset: () => void;
  onDrag: (e: ReactPointerEvent) => void;
  onMove: (x: number, y: number) => void;
};

const MAIN_TABS: Array<[Tab, string]> = [
  ['overview', 'Overview'],
  ['team', 'Team'],
  ['issues', 'Issues'],
  ['discover', 'Discover'],
];

export function App({ page, onMinimize, onClose, onPositionReset, onDrag, onMove }: AppProps) {
  const [following, setFollowing] = useState(true);
  const [chosen, setChosen] = useState('');
  const [tab, setTab] = useState<Tab>(page.issue ? 'issues' : page.repo ? 'overview' : 'discover');
  const [manual, setManual] = useState('');
  const [notice, setNotice] = useState('');
  const [tick, setTick] = useState(0);

  // Follow the GitHub tab as the user navigates: the repository is derived, and the tab
  // is adjusted once per navigation (React's "adjust state when a prop changes" pattern).
  const repo = following && page.repo ? page.repo : chosen || page.repo || '';
  const pageKey = `${page.repo}#${page.issue}`;
  const [seenPage, setSeenPage] = useState(pageKey);
  if (seenPage !== pageKey) {
    setSeenPage(pageKey);
    if (following && page.repo)
      setTab((current) =>
        page.issue ? 'issues' : current === 'issues' || current === 'discover' ? 'overview' : current,
      );
  }

  // Refresh the connection badge when the user comes back from Settings.
  useEffect(() => {
    const onFocus = () => setTick((t) => t + 1);
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);

  const meta = useRequest('repo', { repo }, Boolean(repo));
  const connection = useRequest('connection', {}, true);
  const reloadConnection = connection.reload;
  useEffect(() => reloadConnection(), [tick, reloadConnection]);
  const signedIn = Boolean(connection.value?.connected);
  const core = connection.value?.capacity?.[signedIn ? 'graphql' : 'core'] ?? connection.value?.capacity?.core;

  const choose = (name: string) => {
    const parsed = parseRepo(name);
    if (!parsed) return setNotice('Enter owner/repository or a GitHub repository URL.');
    setNotice('');
    setFollowing(false);
    setChosen(parsed);
    setTab('overview');
  };
  const openSettings = () => void call('settings', {}).catch((e: Error) => setNotice(e.message));
  const needsRepo = tab !== 'discover' && tab !== 'saved';
  const focusIssue = following && page.repo === repo ? page.issue : null;

  // Opening from the launcher, a badge or the toolbar unmounts what had focus;
  // keyboard and screen-reader users land in the panel instead of on GitHub's body.
  const region = useRef<HTMLDivElement>(null);
  useEffect(() => {
    region.current?.focus({ preventScroll: true });
  }, []);

  return (
    <div
      ref={region}
      className="cc-widget"
      role="region"
      aria-label="CONTRI"
      tabIndex={-1}
      onKeyDown={(e) => {
        if (e.key !== 'Escape' || e.defaultPrevented || e.nativeEvent.isComposing) return;
        e.preventDefault();
        e.stopPropagation(); // GitHub's own Escape handlers must not also fire
        // In a text field, Escape only leaves the field (nothing typed is lost); otherwise it
        // minimizes the panel back to its launcher, like closing a popover.
        const target = e.target as HTMLElement;
        if (
          target.closest(
            'input:not([type=checkbox]):not([type=radio]):not([type=button]):not([type=submit]), textarea, select, [contenteditable="true"]',
          )
        )
          (e.currentTarget as HTMLElement).focus();
        else onMinimize();
      }}
    >
      <GlassEffect />
      <header className="cc-header">
        <button
          className="cc-drag"
          title="Drag to move. Arrow keys move 10 pixels."
          aria-label="Move CONTRI; use arrow keys"
          onPointerDown={onDrag}
          onKeyDown={(e) => {
            const dirs: Record<string, [number, number]> = {
              ArrowLeft: [-10, 0],
              ArrowRight: [10, 0],
              ArrowUp: [0, -10],
              ArrowDown: [0, 10],
            };
            if (dirs[e.key]) {
              e.preventDefault();
              onMove(...dirs[e.key]);
            }
          }}
        >
          <GripIcon size={17} />
        </button>
        <Wordmark size={18} />
        <div className="cc-header-actions">
          <button aria-label="Settings and GitHub sign-in" onClick={openSettings}>
            <GearIcon size={16} />
          </button>
          <button aria-label="Minimize CONTRI" onClick={onMinimize}>
            <MinusIcon size={17} />
          </button>
          <button aria-label="Close CONTRI for this tab" onClick={onClose}>
            <CloseIcon size={17} />
          </button>
        </div>
      </header>
      <div className="cc-context">
        <span title={repo}>{repo || 'Explore public GitHub'}</span>
        {page.repo && (
          <button
            onClick={() => {
              if (following) setChosen(repo);
              setFollowing(!following);
            }}
            aria-pressed={following}
          >
            {following ? 'Following tab' : 'Follow tab'}
          </button>
        )}
      </div>
      <nav className="cc-nav" aria-label="CONTRI sections" role="tablist">
        {MAIN_TABS.map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            aria-current={tab === id ? 'page' : undefined}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </nav>
      <div className="cc-tools-row">
        <button aria-current={tab === 'saved' ? 'page' : undefined} onClick={() => setTab('saved')}>
          Saved &amp; watched
        </button>
        {repo && (
          <button aria-current={tab === 'guide' ? 'page' : undefined} onClick={() => setTab('guide')}>
            Contribution guide
          </button>
        )}
      </div>
      <div className="cc-body" key={`${repo}:${tab}`}>
        {notice && <Note>{notice}</Note>}
        {tab === 'saved' ? (
          <SavedTab onSelect={choose} />
        ) : tab === 'discover' ? (
          <DiscoverTab onSelect={choose} signedIn={signedIn} login={connection.value?.login} />
        ) : needsRepo && !repo ? (
          <section className="cc-section">
            <span className="cc-eyebrow">A LITTLE DIRECTION</span>
            <h2>Good contributions start here.</h2>
            <p>
              Open a GitHub repository, or enter one, to see activity, team responses and issues you can actually take.
            </p>
            <form
              className="cc-search"
              onSubmit={(e) => {
                e.preventDefault();
                choose(manual);
              }}
            >
              <input
                aria-label="Open repository"
                placeholder="owner/repository"
                value={manual}
                onChange={(e) => setManual(e.target.value)}
              />
              <button aria-label="Open repository">
                <ArrowIcon size={17} />
              </button>
            </form>
            <button className="cc-primary" onClick={() => setTab('discover')}>
              Find a project <ArrowIcon size={16} />
            </button>
          </section>
        ) : meta.error ? (
          <section className="cc-section">
            <Note onRetry={() => meta.reload(true)}>{meta.error}</Note>
          </section>
        ) : !meta.value ? (
          <section className="cc-section">
            <Loading>Reading repository…</Loading>
          </section>
        ) : tab === 'team' ? (
          <TeamTab repo={repo} signedIn={signedIn} />
        ) : tab === 'issues' ? (
          <IssuesTab repo={repo} focusIssue={focusIssue} signedIn={signedIn} />
        ) : tab === 'guide' ? (
          <GuideTab repo={repo} />
        ) : (
          <OverviewTab repo={repo} meta={meta.value} go={setTab} />
        )}
      </div>
      <footer className="cc-footer">
        <button onClick={openSettings}>
          {signedIn ? (
            <>
              <CheckIcon size={12} />
              {connection.value?.login ? `@${connection.value.login}` : 'Signed in'}
            </>
          ) : (
            <>
              <GearIcon size={12} />
              Sign in with GitHub
            </>
          )}
        </button>
        <span title={core?.reset ? `Resets ${new Date(core.reset * 1000).toLocaleTimeString()}` : undefined}>
          {core?.remaining != null
            ? `${count(core.remaining)} requests left`
            : signedIn
              ? '5,000 requests/hour'
              : '60 requests/hour'}
        </span>
        <button onClick={onPositionReset} title="Move CONTRI back to the bottom-right corner">
          Reset position
        </button>
      </footer>
    </div>
  );
}
