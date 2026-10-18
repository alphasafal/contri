export const time = (value: string) =>
  new Date(value).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

export const day = (value: string) =>
  new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

export function hours(value: number | null): string {
  if (value === null) return '—';
  const minutes = Math.round(value * 60);
  if (minutes < 60) return `${minutes}m`;
  const tenths = Math.round(value * 10) / 10;
  if (tenths < 48) return `${tenths}h`;
  return `${Math.round((value / 24) * 10) / 10}d`;
}

export const count = (value: number | null | undefined) => (value == null ? '—' : value.toLocaleString());

export function ago(value: string | number, now = Date.now()): string {
  const ms = now - (typeof value === 'number' ? value : Date.parse(value));
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const h = Math.round(minutes / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export const plural = (n: number, word: string, many = `${word}s`) => `${n.toLocaleString()} ${n === 1 ? word : many}`;
