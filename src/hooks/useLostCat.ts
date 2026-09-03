import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  confirmLostCatMatch,
  createLostCat,
  getLostCat,
  getLostCatMatches,
  getMyLostCats,
  rejectLostCatMatch,
  triggerLostCatMatch,
  triggerSightingLostMatch,
} from '@/api/ai';
import { AI_FEATURES } from '@/constants/ai';
import { captureError, track } from '@/lib/observability';
import { queryKeys } from '@/lib/queryClient';
import type { CreateLostCatInput, LostCat, LostCatMatch } from '@/types/ai';

/**
 * Lost-cat reunification (AI-M4 #5) — React Query hooks. The matching engine
 * and push loop live server-side (built by the parallel ai-embeddings-agent);
 * these hooks only read the user's own posts and surface SUGGESTED matches for
 * the owner to confirm/reject. Never auto-claims a match — every decision is
 * the owner's.
 *
 * Gated behind `AI_FEATURES.lostCatReunion`: when false the queries are
 * disabled and the UI renders nothing.
 */

export function useMyLostCats() {
  return useQuery<LostCat[], Error>({
    queryKey: queryKeys.lostCats,
    queryFn: () => getMyLostCats(),
    enabled: AI_FEATURES.lostCatReunion,
  });
}

export function useLostCat(id?: string) {
  return useQuery<LostCat, Error>({
    queryKey: queryKeys.lostCat(id ?? ''),
    queryFn: () => getLostCat(id as string),
    enabled: !!id && AI_FEATURES.lostCatReunion,
  });
}

export function useLostCatMatches(lostCatId?: string) {
  return useQuery<LostCatMatch[], Error>({
    queryKey: queryKeys.lostCatMatches(lostCatId ?? ''),
    queryFn: () => getLostCatMatches(lostCatId as string),
    enabled: !!lostCatId && AI_FEATURES.lostCatReunion,
  });
}

/**
 * Create a lost-cat post. On success, fire-and-forget `triggerLostCatMatch` so
 * the server matches the new post against existing sightings immediately (the
 * continuous match loop handles future sightings via the report-flow trigger).
 * The trigger is best-effort: it must never block or fail the post — errors are
 * captured, not thrown. Instruments `ai_lost_cat_created` on success.
 */
export function useCreateLostCat() {
  const qc = useQueryClient();
  return useMutation<LostCat, Error, CreateLostCatInput>({
    mutationFn: (input) => createLostCat(input),
    onSuccess: (lostCat) => {
      track('ai_lost_cat_created', { id: lostCat.id });
      qc.invalidateQueries({ queryKey: queryKeys.lostCats });
      void triggerLostCatMatch(lostCat.id).catch((e) =>
        captureError(e, { source: 'lost-cat-create-trigger' }),
      );
    },
  });
}

/**
 * Confirm a suggested lost-cat match — "yes, that's my cat." Invalidates the
 * post's matches + the lost-cats list (status may flip to `matched`).
 * Instruments `ai_lost_cat_match_confirmed` on success.
 */
export function useConfirmLostCatMatch(lostCatId: string) {
  const qc = useQueryClient();
  return useMutation<LostCatMatch, Error, string>({
    mutationFn: (matchId) => confirmLostCatMatch(matchId),
    onSuccess: (_result, matchId) => {
      track('ai_lost_cat_match_confirmed', { lostCatId, matchId });
      qc.invalidateQueries({ queryKey: queryKeys.lostCatMatches(lostCatId) });
      qc.invalidateQueries({ queryKey: queryKeys.lostCats });
    },
  });
}

/**
 * Reject a suggested lost-cat match — "not them." Invalidates the post's
 * matches + the lost-cats list. Instruments `ai_lost_cat_match_rejected`.
 */
export function useRejectLostCatMatch(lostCatId: string) {
  const qc = useQueryClient();
  return useMutation<LostCatMatch, Error, string>({
    mutationFn: (matchId) => rejectLostCatMatch(matchId),
    onSuccess: (_result, matchId) => {
      track('ai_lost_cat_match_rejected', { lostCatId, matchId });
      qc.invalidateQueries({ queryKey: queryKeys.lostCatMatches(lostCatId) });
      qc.invalidateQueries({ queryKey: queryKeys.lostCats });
    },
  });
}

/**
 * The other direction of the continuous match loop (AI-M4 #5): after a NEW
 * sighting is posted, ask the server to match it against open lost-cat posts
 * (and push the owner on a hit). Fire-and-forget by contract — no-ops when the
 * flag is off, never throws, never blocks the report. The server verifies the
 * caller is the sighting's reporter. Call as
 * `void matchSightingAgainstLostCatsBestEffort(sightingId)`.
 */
export async function matchSightingAgainstLostCatsBestEffort(sightingId: string): Promise<void> {
  if (!AI_FEATURES.lostCatReunion) return;
  try {
    await triggerSightingLostMatch(sightingId);
    track('ai_lost_cat_sighting_match_triggered', { sighting_id: sightingId });
  } catch (e) {
    captureError(e, { source: 'sighting-lost-cat-match-trigger' });
  }
}
