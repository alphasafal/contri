const MINUTE = 60_000;

/**
 * How long each report stays fresh. Partial reports (anything with coverage
 * warnings) are still cached — just for a third of the time — so big repositories
 * do not burn request capacity on every visit.
 */
export const TTL: Record<string, number> = {
  repo: 30 * MINUTE,
  overview: 30 * MINUTE,
  team: 6 * 60 * MINUTE,
  documents: 24 * 60 * MINUTE,
  issues: 10 * MINUTE,
  insight: 10 * MINUTE,
  discover: 6 * 60 * MINUTE,
};

export function ttlFor(op: string, partial: boolean): number {
  const base = TTL[op] ?? 10 * MINUTE;
  return partial ? Math.round(base / 3) : base;
}

export function isFresh(entry: { at: number; ttl: number } | undefined, now = Date.now()): boolean {
  return Boolean(entry && now - entry.at < entry.ttl);
}

/**
 * "Anonymous mode samples 10 items" describes the mode, not a failure: a retry
 * would return the same report, so it must not shorten the cache. Only
 * warnings about data that could not be loaded make a report partial.
 */
export const isCoverageWarning = (warning: unknown) =>
  typeof warning !== 'string' || !/^Anonymous mode\b/.test(warning);

export function isPartial(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const record = value as { warnings?: unknown[]; partial?: boolean; state?: string };
  return Boolean(record.partial || record.warnings?.some(isCoverageWarning) || record.state === 'incomplete');
}
