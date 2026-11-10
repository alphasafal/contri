import type { Connection, DevicePoll, DeviceStart } from '../background/auth';
import type { Capacity } from '../background/transport';
import type { Repo } from '../background/reports/repo';
import type { OverviewReport } from '../background/reports/overview';
import type { TeamReport } from '../background/reports/team';
import type { DocumentsReport } from '../background/reports/documents';
import type { IssueQuery, IssueSearch } from '../background/reports/issues';
import type { BulkInsightReport, InsightReport } from '../background/reports/insight';
import type { DiscoverInput, DiscoverReport } from '../background/reports/discover';
import type { Saved } from '../core/brief';
import type { ClaimState } from '../core/claims';

export type WidgetMode = 'launcher' | 'issues' | 'open';
export type BadgeMode = 'smart' | 'always' | 'click' | 'off';

export type Prefs = {
  /** launcher: start minimized · issues: open on issue pages · open: open on every repository. */
  widget: WidgetMode;
  /** smart: check automatically when signed in, on click when anonymous. */
  badges: BadgeMode;
  notifications: boolean;
  position: { x: number; y: number } | null;
};

export const DEFAULT_PREFS: Prefs = { widget: 'launcher', badges: 'smart', notifications: true, position: null };

export type WatchSnapshot = { state: string; assignees: string[]; openPrs: number; claim: ClaimState };
export type Watched = {
  repo: string;
  number: number;
  title: string;
  url: string;
  addedAt: string;
  checkedAt?: string;
  snapshot?: WatchSnapshot;
  lastChange?: string;
};

export type ConnectionInfo = Connection & { capacity: Record<string, Capacity> };

export type Operations = {
  repo: { input: { repo: string }; output: Repo };
  overview: { input: { repo: string }; output: OverviewReport };
  team: { input: { repo: string }; output: TeamReport };
  documents: { input: { repo: string }; output: DocumentsReport };
  issues: { input: IssueQuery; output: IssueSearch };
  insight: { input: { repo: string; number: number }; output: InsightReport };
  /** Verdicts for a whole issue list page in one request (signed in only). */
  insights: { input: { repo: string; numbers: number[] }; output: BulkInsightReport };
  discover: { input: DiscoverInput; output: DiscoverReport };
  saved: { input: Record<string, never>; output: Saved[] };
  save: { input: { item: Saved; updateNote?: boolean }; output: Saved[] };
  removeSaved: { input: { url: string }; output: Saved[] };
  watchList: { input: Record<string, never>; output: Watched[] };
  watchAdd: { input: { repo: string; number: number; title: string }; output: Watched[] };
  watchRemove: { input: { url: string }; output: Watched[] };
  prefs: { input: Record<string, never>; output: Prefs };
  setPrefs: { input: Partial<Prefs>; output: Prefs };
  connection: { input: Record<string, never>; output: ConnectionInfo };
  settings: { input: Record<string, never>; output: boolean };
  refresh: { input: Record<string, never>; output: boolean };
  connect: { input: { token: string; remember: boolean }; output: Connection };
  disconnect: { input: Record<string, never>; output: Connection };
  deviceStart: { input: Record<string, never>; output: DeviceStart };
  devicePoll: { input: { remember: boolean }; output: DevicePoll };
};

export type Operation = keyof Operations;
export type Message<K extends Operation = Operation> = {
  op: K;
  input: Operations[K]['input'];
  /** Skip the cache and fetch fresh evidence. */
  force?: boolean;
  /** Only return a cached report (or null); never spend GitHub requests. */
  cacheOnly?: boolean;
};
export type Reply = { ok: true; value: unknown } | { ok: false; error: string };

export const PORT_NAME = 'contri';

/** Report operations whose results are cached in the background worker. */
export const CACHED_OPS = [
  'repo',
  'overview',
  'team',
  'documents',
  'issues',
  'insight',
  'insights',
  'discover',
] as const;
/** Operations only the extension's own Settings page may call. */
export const TRUSTED_OPS = ['connect', 'disconnect', 'deviceStart', 'devicePoll'] as const;

export function call<K extends Operation>(
  op: K,
  input: Operations[K]['input'],
  options: { signal?: AbortSignal; force?: boolean } = {},
): Promise<Operations[K]['output']> {
  return send(op, input, options) as Promise<Operations[K]['output']>;
}

/** Returns a cached report without making any GitHub request, or null when nothing is cached. */
export function peek<K extends (typeof CACHED_OPS)[number]>(op: K, input: Operations[K]['input']) {
  return send(op, input, { cacheOnly: true }) as Promise<Operations[K]['output'] | null>;
}

function send<K extends Operation>(
  op: K,
  input: Operations[K]['input'],
  options: { signal?: AbortSignal; force?: boolean; cacheOnly?: boolean },
): Promise<unknown> {
  if (typeof chrome === 'undefined' || !chrome.runtime?.connect)
    return Promise.reject(new Error('Install the extension to read live GitHub data. This preview shows layout only.'));
  const { signal, force, cacheOnly } = options;
  return new Promise((resolve, reject) => {
    let port: chrome.runtime.Port;
    try {
      port = chrome.runtime.connect({ name: PORT_NAME });
    } catch {
      reject(new Error('CONTRI was updated. Reload this GitHub tab.'));
      return;
    }
    let finished = false;
    const finish = (error?: Error, value?: unknown) => {
      if (finished) return;
      finished = true;
      signal?.removeEventListener('abort', abort);
      try {
        port.disconnect();
      } catch {
        /* already closed */
      }
      if (error) reject(error);
      else resolve(value);
    };
    const abort = () => finish(new DOMException('Cancelled', 'AbortError'));
    port.onMessage.addListener((reply: Reply) =>
      finish(reply.ok ? undefined : new Error(reply.error || 'Request failed'), reply.ok ? reply.value : undefined),
    );
    port.onDisconnect.addListener(() =>
      finish(new Error(chrome.runtime.lastError?.message || 'Extension connection closed. Reload this GitHub tab.')),
    );
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) return abort();
    port.postMessage({ op, input, force, cacheOnly } satisfies Message<K>);
  });
}
