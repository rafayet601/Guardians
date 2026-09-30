import type { NearbySighting } from '@/types/models';

type Rankable = Pick<NearbySighting, 'status' | 'needs_urgent_help' | 'is_injured'>;
type Sortable = Rankable & Pick<NearbySighting, 'distance_m'>;

/**
 * Where a cat sits in the "what needs a Guardian right now" order. Lower comes
 * first: unclaimed urgent cats, then unclaimed injured ones, then the rest of
 * the unclaimed, then cats a Guardian is already on, then the adoption side.
 */
export function triageRank(s: Rankable): number {
  switch (s.status) {
    case 'spotted':
      return s.needs_urgent_help ? 0 : s.is_injured ? 1 : 2;
    case 'claimed':
    case 'in_rescue':
      return 3;
    case 'available':
      return 4;
    case 'safe':
      return 5;
    default:
      return 6;
  }
}

/**
 * Order sightings so the most actionable come first, nearest first within a
 * tier. A plain distance sort buries an urgent cat behind resolved ones, and
 * the list is capped, so the cap would then hide the cats that need help.
 */
export function sortForTriage<T extends Sortable>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => triageRank(a) - triageRank(b) || a.distance_m - b.distance_m);
}
