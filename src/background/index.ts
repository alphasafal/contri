import { connect, connection, disconnect, getToken, initializeAuth, pollDeviceFlow, startDeviceFlow } from './auth';
import { allCapacity, authenticatedFetch, resetTransport } from './transport';
import { clearMemory, setTransport } from './github';
import { cacheKey, clearCache, loadRoster, readCache, saveRoster, writeCache } from './cache';
import { validateMessage } from './validation';
import { addWatched, describeChange, snapshotOf, WATCH_ALARM, WATCH_LIMIT } from './watch';
import { createCtx } from './reports/context';
import { publicRepo } from './reports/repo';
import { overview } from './reports/overview';
import { team } from './reports/team';
import { documents } from './reports/documents';
import { searchIssues, type IssueQuery } from './reports/issues';
import { insight, type InsightReport } from './reports/insight';
import { discover, type DiscoverInput } from './reports/discover';
import { createShortlistStore } from '../core/shortlist';
import type { Saved } from '../core/brief';
import type { Roster, RosterBasis } from '../core/team';
import { CACHED_OPS, DEFAULT_PREFS, PORT_NAME, type Message, type Prefs, type Watched } from '../shared/protocol';

setTransport(authenticatedFetch);
// A storage failure at start is reported by the first request; it must not be an unhandled rejection.
void initializeAuth().catch(() => {});

/* ---------- storage-backed stores ---------- */

const local = chrome.storage.local;
const shortlist = createShortlistStore(
  async () => ((await local.get('shortlist')).shortlist as Saved[] | undefined) ?? [],
  async (rows) => local.set({ shortlist: rows }),
);

async function prefs(): Promise<Prefs> {
  const stored = (await local.get('prefs')).prefs as Partial<Prefs> | undefined;
  return { ...DEFAULT_PREFS, ...stored };
}

async function setPrefs(change: Partial<Prefs>) {
  const next = { ...(await prefs()), ...change };
  await local.set({ prefs: next });
  // Content scripts cannot read chrome.storage (TRUSTED_CONTEXTS), so a change made in
  // Settings is pushed to open GitHub tabs; otherwise badges only notice on navigation.
  if (change.badges !== undefined) void broadcastPrefs(next);
  return next;
}

async function broadcastPrefs(next: Prefs) {
  try {
    const tabs = await chrome.tabs.query({ url: 'https://github.com/*' });
    await Promise.all(
      tabs.map((t) =>
        t.id === undefined
          ? undefined
          : chrome.tabs.sendMessage(t.id, { type: 'CONTRI_PREFS', prefs: next }).catch(() => {}),
      ),
    );
  } catch {
    // No open tab, or no permission to list them: the next navigation picks it up.
  }
}

const watchlist = async () => ((await local.get('watchlist')).watchlist as Watched[] | undefined) ?? [];
async function saveWatchlist(list: Watched[]) {
  await local.set({ watchlist: list });
  if (list.length) await chrome.alarms.create(WATCH_ALARM, { periodInMinutes: 60, delayInMinutes: 1 });
  else await chrome.alarms.clear(WATCH_ALARM);
  return list;
}

const toRoster = (entries?: Array<{ login: string; basis: string[] }>): Roster | undefined =>
  entries && new Map(entries.map((e) => [e.login.toLowerCase(), { login: e.login, basis: e.basis as RosterBasis[] }]));

/* ---------- operations ---------- */

let epoch = 0;
const jobs = new Map<
  string,
  { promise: Promise<unknown>; controller: AbortController; users: Set<chrome.runtime.Port> }
>();

async function invalidate() {
  epoch++;
  for (const job of jobs.values()) job.controller.abort();
  jobs.clear();
  clearMemory();
  resetTransport();
  await clearCache();
}

async function report(message: Message, signal: AbortSignal): Promise<unknown> {
  const authed = Boolean(await getToken());
  const ctx = createCtx(authed, signal);
  const input = message.input as Record<string, unknown>;
  switch (message.op) {
    case 'repo':
      return publicRepo(ctx, input.repo as string);
    case 'overview':
      return overview(ctx, input.repo as string);
    case 'team': {
      const value = await team(ctx, input.repo as string);
      await saveRoster(input.repo as string, value.roster);
      return value;
    }
    case 'documents':
      return documents(ctx, input.repo as string);
    case 'issues':
      return searchIssues(ctx, input as IssueQuery);
    case 'insight':
      return insight(
        ctx,
        input.repo as string,
        input.number as number,
        toRoster(await loadRoster(input.repo as string)),
      );
    case 'discover':
      return discover(ctx, input as unknown as DiscoverInput);
  }
}

async function perform(message: Message): Promise<unknown> {
  const p = message.input as Record<string, unknown>;
  switch (message.op) {
    case 'saved':
      return ((await local.get('shortlist')).shortlist as Saved[] | undefined) ?? [];
    case 'save':
      return shortlist.save(p.item as Saved, p.updateNote === true);
    case 'removeSaved':
      return shortlist.remove(p.url as string);
    case 'watchList':
      return watchlist();
    case 'watchAdd': {
      const authed = Boolean(await getToken());
      const item = p as { repo: string; number: number; title: string };
      const list = addWatched(await watchlist(), item, authed ? WATCH_LIMIT.signedIn : WATCH_LIMIT.anonymous);
      // Start from the last known state so the first hourly check can already report a change.
      const known = await readCache(cacheKey('insight', { repo: item.repo, number: item.number }, authed));
      // The new entry is first only when it was really added; compare the URL, not the
      // number, so alice/y#5 never receives bob/x#5's snapshot.
      if (known && list[0]?.url === `https://github.com/${item.repo}/issues/${item.number}` && !list[0].snapshot)
        list[0] = {
          ...list[0],
          snapshot: snapshotOf(known.value as InsightReport),
          checkedAt: new Date().toISOString(),
        };
      return saveWatchlist(list);
    }
    case 'watchRemove':
      return saveWatchlist((await watchlist()).filter((w) => w.url !== p.url));
    case 'prefs':
      return prefs();
    case 'setPrefs':
      return setPrefs(p as Partial<Prefs>);
    case 'connection':
      return { ...(await connection()), capacity: allCapacity() };
    case 'settings':
      await chrome.runtime.openOptionsPage();
      return true;
    case 'refresh':
      await invalidate();
      return true;
    case 'connect': {
      const value = await connect(p.token as string, p.remember as boolean);
      await invalidate();
      return value;
    }
    case 'disconnect': {
      const value = await disconnect();
      await invalidate();
      return value;
    }
    case 'deviceStart':
      return startDeviceFlow();
    case 'devicePoll': {
      const value = await pollDeviceFlow(p.remember as boolean);
      if (value.status === 'connected') await invalidate();
      return value;
    }
    default:
      throw new Error('Operation not allowed');
  }
}

async function cached(message: Message, port: chrome.runtime.Port): Promise<unknown> {
  const authed = Boolean(await getToken());
  const key = cacheKey(message.op, message.input, authed);
  if (!message.force) {
    const hit = await readCache(key);
    if (hit) return hit.value;
    if (message.cacheOnly) return null;
  }
  // A request already in flight is as fresh as a forced one: join it. One whose
  // last user just left is already cancelled; it stays in the map until the
  // fetch settles, so a newcomer must start afresh instead of inheriting its
  // "Cancelled" error.
  let job = jobs.get(key);
  if (job?.controller.signal.aborted) {
    jobs.delete(key);
    job = undefined;
  }
  if (!job) {
    const controller = new AbortController();
    const started = epoch;
    const promise = report(message, controller.signal).then(async (value) => {
      if (started !== epoch || controller.signal.aborted) throw new DOMException('Cancelled', 'AbortError');
      await writeCache(key, message.op, value);
      return value;
    });
    const created = { promise, controller, users: new Set<chrome.runtime.Port>() };
    jobs.set(key, created);
    void promise
      .finally(() => {
        if (jobs.get(key) === created) jobs.delete(key);
      })
      .catch(() => {});
    job = created;
  }
  job.users.add(port);
  port.onDisconnect.addListener(() => {
    job!.users.delete(port);
    if (!job!.users.size) job!.controller.abort();
  });
  return job.promise;
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== PORT_NAME || port.sender?.id !== chrome.runtime.id) return port.disconnect();
  const senderUrl = port.sender?.url ?? '';
  const trusted = senderUrl.startsWith(chrome.runtime.getURL('settings.html'));
  if (!trusted && !/^https:\/\/github\.com\//.test(senderUrl)) return port.disconnect();
  let handled = false;
  port.onMessage.addListener(async (raw) => {
    if (handled) return;
    handled = true;
    try {
      await initializeAuth();
      const message = validateMessage(raw, trusted);
      const value = (CACHED_OPS as readonly string[]).includes(message.op)
        ? await cached(message, port)
        : await perform(message);
      port.postMessage({ ok: true, value });
    } catch (error) {
      try {
        port.postMessage({ ok: false, error: error instanceof Error ? error.message : 'Request unavailable' });
      } catch {
        /* the tab closed */
      }
    }
  });
});

/* ---------- toolbar button ---------- */

chrome.action.onClicked.addListener(async (tab) => {
  if (tab.id && tab.url?.startsWith('https://github.com/')) {
    try {
      await chrome.tabs.sendMessage(tab.id, { type: 'CONTRI_TOGGLE' });
    } catch {
      // Tabs opened before install have no content script yet: inject it, then open.
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['widget.js'] });
      setTimeout(() => void chrome.tabs.sendMessage(tab.id!, { type: 'CONTRI_TOGGLE' }).catch(() => {}), 400);
    }
  } else await chrome.tabs.create({ url: 'https://github.com/explore' });
});

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  if (reason === 'install') await chrome.tabs.create({ url: chrome.runtime.getURL('settings.html?welcome=1') });
  if ((await watchlist()).length) await chrome.alarms.create(WATCH_ALARM, { periodInMinutes: 60 });
});

/* ---------- watched issues ---------- */

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== WATCH_ALARM) return;
  const list = await watchlist();
  if (!list.length) return;
  const authed = Boolean(await getToken());
  const { notifications } = await prefs();
  const next: Watched[] = [];
  for (const item of list) {
    try {
      const ctx = createCtx(authed);
      const value = await insight(ctx, item.repo, item.number, toRoster(await loadRoster(item.repo)));
      const snapshot = snapshotOf(value);
      const change = describeChange(item.snapshot, snapshot);
      await writeCache(cacheKey('insight', { repo: item.repo, number: item.number }, authed), 'insight', value);
      if (change && notifications)
        await Promise.resolve(
          chrome.notifications.create(item.url, {
            type: 'basic',
            iconUrl: chrome.runtime.getURL('icon-128.png'),
            title: `${item.repo}#${item.number}`,
            message: `${change}\n${item.title}`,
            priority: 1,
          }),
        ).catch(() => {});
      next.push({ ...item, snapshot, checkedAt: new Date().toISOString(), lastChange: change ?? item.lastChange });
    } catch {
      next.push(item);
    }
  }
  // Keep any items the user added or removed while we were checking.
  const current = await watchlist();
  await local.set({ watchlist: current.map((w) => next.find((n) => n.url === w.url) ?? w) });
});

chrome.notifications?.onClicked.addListener((id) => {
  if (id.startsWith('https://github.com/')) void chrome.tabs.create({ url: id });
});
