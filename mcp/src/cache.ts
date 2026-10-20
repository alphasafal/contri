import { isFresh, isPartial, ttlFor } from '../../src/core/cache-policy';
import type { RosterBasis } from '../../src/core/team';

/**
 * In-memory replacement for the extension's `chrome.storage` cache. Same keys,
 * same TTLs (`core/cache-policy.ts`), same rule that partial reports are kept
 * for a third of the time. Nothing is written to disk; it ends with the process.
 */

const MAX_ENTRIES = 200;
const ROSTER_TTL = 7 * 86_400_000;

type Entry = { at: number; ttl: number; value: unknown };
export type RosterEntries = Array<{ login: string; basis: RosterBasis[] }>;

export function createCache(now: () => number = Date.now) {
  const reports = new Map<string, Entry>();
  const rosters = new Map<string, { at: number; entries: RosterEntries }>();
  const inflight = new Map<string, Promise<unknown>>();

  const key = (op: string, input: unknown, authed: boolean) => `${op}:${authed ? 'a' : 'p'}:${JSON.stringify(input)}`;

  function read(k: string) {
    const entry = reports.get(k);
    if (isFresh(entry, now())) return entry!.value;
    reports.delete(k);
    return undefined;
  }

  function write(k: string, op: string, value: unknown) {
    reports.delete(k);
    reports.set(k, { at: now(), ttl: ttlFor(op, isPartial(value)), value });
    while (reports.size > MAX_ENTRIES) reports.delete(reports.keys().next().value!);
  }

  return {
    /** Returns a fresh cached report, joins an identical request in flight, or runs `load`. */
    async get<T>(op: string, input: unknown, authed: boolean, load: () => Promise<T>, force = false): Promise<T> {
      const k = key(op, input, authed);
      if (!force) {
        const hit = read(k);
        if (hit !== undefined) return hit as T;
      }
      const running = inflight.get(k);
      if (running) return running as Promise<T>;
      const promise = load().then((value) => {
        write(k, op, value);
        return value;
      });
      inflight.set(k, promise);
      try {
        return await promise;
      } finally {
        if (inflight.get(k) === promise) inflight.delete(k);
      }
    },
    saveRoster(repo: string, entries: RosterEntries) {
      rosters.set(repo.toLowerCase(), { at: now(), entries });
    },
    loadRoster(repo: string): RosterEntries | undefined {
      const stored = rosters.get(repo.toLowerCase());
      return stored && now() - stored.at < ROSTER_TTL ? stored.entries : undefined;
    },
    clear() {
      reports.clear();
      rosters.clear();
    },
  };
}

export type Cache = ReturnType<typeof createCache>;
