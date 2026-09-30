/**
 * Hide reports written by people the viewer has blocked. Blocking promises
 * "you won't see their reports anymore", and the read paths (nearby_sightings
 * and the sightings table) do not filter by blocks, so the client applies the
 * viewer's own block list. Reports with no reporter (deleted accounts, seeded
 * data) are never hidden by this.
 */
export function withoutBlocked<T extends { reporter_id: string | null }>(
  items: readonly T[],
  blocked: ReadonlySet<string>,
): T[] {
  if (blocked.size === 0) return items as T[];
  return items.filter((item) => !item.reporter_id || !blocked.has(item.reporter_id));
}
