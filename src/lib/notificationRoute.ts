const UUID = /^[0-9a-f-]{36}$/i;

interface NotificationData {
  type?: unknown;
  sighting_id?: unknown;
}

function asData(data: unknown): NotificationData {
  return data && typeof data === 'object' ? (data as NotificationData) : {};
}

/** The sighting a push is about, if it names one. */
export function notificationSightingId(data: unknown): string | null {
  const { sighting_id } = asData(data);
  return typeof sighting_id === 'string' && UUID.test(sighting_id) ? sighting_id : null;
}

/**
 * Where tapping a push should go. A lost-cat match carries the sighting id too,
 * but the owner's confirm/reject controls live on the lost-cat screen, not on
 * the sighting, so that type must win. A background-check decision is about
 * the person, not a cat, and opens their screening.
 */
export function notificationRoute(data: unknown): string | null {
  const { type } = asData(data);
  if (type === 'lost_cat_match') return '/lost-cat';
  if (type === 'screening_decided') return '/adopt/screening';
  const sightingId = notificationSightingId(data);
  return sightingId ? `/sighting/${sightingId}` : null;
}
