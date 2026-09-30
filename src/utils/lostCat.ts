/**
 * "When did you last see them?" as a handful of choices instead of a typed
 * timestamp. The free-text field advertised "2024-03-15 18:00", which is not an
 * ISO date and is not reliably parsed by every JS engine the app runs on, so a
 * correctly-filled form could be rejected. Matching only needs a rough time.
 */
export const LAST_SEEN_OPTIONS = [
  { key: 'now', label: 'Just now', hoursAgo: 0 },
  { key: 'hour', label: 'An hour ago', hoursAgo: 1 },
  { key: 'today', label: 'Earlier today', hoursAgo: 6 },
  { key: 'yesterday', label: 'Yesterday', hoursAgo: 24 },
  { key: 'days', label: 'A few days ago', hoursAgo: 72 },
] as const;

export type LastSeenKey = (typeof LAST_SEEN_OPTIONS)[number]['key'];

/** ISO timestamp for a last-seen choice, relative to `now`. */
export function lastSeenIso(key: LastSeenKey, now: number = Date.now()): string {
  const option = LAST_SEEN_OPTIONS.find((o) => o.key === key) ?? LAST_SEEN_OPTIONS[0];
  return new Date(now - option.hoursAgo * 3_600_000).toISOString();
}
