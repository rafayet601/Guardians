import { formatDistanceToNowStrict } from 'date-fns';

/** "850 m" or "2.3 km" */
export function formatDistance(meters: number): string {
  if (!Number.isFinite(meters)) return '';
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(meters < 10000 ? 1 : 0)} km`;
}

/** "3 hours ago" */
export function timeAgo(iso: string): string {
  try {
    return formatDistanceToNowStrict(new Date(iso), { addSuffix: true });
  } catch {
    return '';
  }
}

/**
 * Level math, mirroring the DB curve `level = floor(sqrt(points / 50)) + 1`.
 * Points to reach level L is `50 * (L - 1)^2`.
 */
export function levelProgress(points: number) {
  const p = Math.max(0, points);
  const level = Math.floor(Math.sqrt(p / 50)) + 1;
  const floorPoints = 50 * (level - 1) ** 2;
  const nextLevelPoints = 50 * level ** 2;
  const span = nextLevelPoints - floorPoints;
  const intoLevel = p - floorPoints;
  return {
    level,
    intoLevel,
    span,
    toNext: nextLevelPoints - p,
    nextLevelPoints,
    progress: span > 0 ? Math.min(1, intoLevel / span) : 0,
  };
}

export function initialsOf(name?: string | null): string {
  if (!name) return '🐾';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** Compact number for badges/counters: 1200 -> "1.2k" */
export function compactNumber(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}
