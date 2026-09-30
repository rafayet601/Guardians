import type { CatStatus, Sighting } from '@/types/models';

/** A rescue the Guardian is still responsible for. */
export const isActiveRescue = (status: CatStatus): boolean =>
  status === 'claimed' || status === 'in_rescue';

const RANK: Partial<Record<CatStatus, number>> = {
  claimed: 0,
  in_rescue: 0,
  safe: 1,
  available: 1,
  adopted: 2,
};

/**
 * A Guardian's cats, open commitments first (those are what they need to find
 * and update), then cats in care, then adopted ones; newest claim first within
 * each group.
 */
export function sortRescues<T extends Pick<Sighting, 'status' | 'claimed_at'>>(
  items: readonly T[],
): T[] {
  const claimedAt = (item: T) => Date.parse(item.claimed_at ?? '') || 0;
  return [...items].sort(
    (a, b) => (RANK[a.status] ?? 3) - (RANK[b.status] ?? 3) || claimedAt(b) - claimedAt(a),
  );
}
