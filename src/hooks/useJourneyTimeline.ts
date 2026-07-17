import { useQuery } from '@tanstack/react-query';

import { getSightingLinks } from '@/api/ai';
import { getSighting } from '@/api/sightings';
import { AI_FEATURES } from '@/constants/ai';
import { queryKeys } from '@/lib/queryClient';

/**
 * One stop on a cat's journey (AI-M4 #6) — a sighting of the same cat (linked
 * via confirmed sighting_links), ordered by time. `isPrecise` is the viewer's
 * view of the sighting's coordinates: false when lat/lng are coarsened (~110m)
 * for non-owners — fine for a journey overview map, never the rescue pin.
 */
export interface JourneyStop {
  sightingId: string;
  createdAt: string;
  lat: number;
  lng: number;
  title: string | null;
  isPrecise: boolean;
  thumbnailUrl: string | null;
}

export interface JourneyTimelineResult {
  stops: JourneyStop[];
  hasJourney: boolean;
}

/**
 * Build the time-ordered journey for a sighting (AI-M4 #6). Fetches the
 * sighting's CONFIRMED links (suggested/rejected are history, not a journey),
 * then fetches each linked sighting + the current one, sorts by `created_at`,
 * and returns the ordered stops. `hasJourney` is true when there are ≥2 stops
 * — the UI renders nothing below that threshold.
 *
 * Gated behind `AI_FEATURES.journeyTimeline`. Individual sighting fetches that
 * fail (e.g. a linked sighting deleted between the link and now) are dropped
 * rather than failing the whole query — a partial journey is still useful.
 */
export function useJourneyTimeline(sightingId?: string, canManage = false) {
  return useQuery<JourneyTimelineResult, Error>({
    queryKey: queryKeys.journeyTimeline(sightingId ?? ''),
    queryFn: async (): Promise<JourneyTimelineResult> => {
      if (!sightingId) return { stops: [], hasJourney: false };
      const links = await getSightingLinks(sightingId);
      const confirmedLinks = links.filter((l) => l.status === 'confirmed');
      const ids = new Set<string>([sightingId]);
      for (const l of confirmedLinks) {
        ids.add(l.sightingId);
        ids.add(l.linkedSightingId);
      }
      const sightings = await Promise.all(
        Array.from(ids).map((id) => getSighting(id).catch(() => null)),
      );
      const stops: JourneyStop[] = [];
      for (const s of sightings) {
        if (!s || s.lat == null || s.lng == null) continue;
        stops.push({
          sightingId: s.id,
          createdAt: s.created_at,
          lat: s.lat,
          lng: s.lng,
          title: s.title,
          isPrecise: s.is_precise ?? false,
          thumbnailUrl: s.photos?.[0]?.url ?? null,
        });
      }
      stops.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      return { stops, hasJourney: stops.length >= 2 };
    },
    // Gated on canManage: get_sighting_links (0023) raises for everyone except
    // the sighting's reporter/guardian, so running the query for other viewers
    // is guaranteed failure noise. If journeys ever become community-visible,
    // relax the RPC first, then this gate.
    enabled: !!sightingId && canManage && AI_FEATURES.journeyTimeline,
  });
}
