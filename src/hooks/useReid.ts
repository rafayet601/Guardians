import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { confirmSightingLink, getReidCandidates, rejectSightingLink } from '@/api/ai';
import { AI_FEATURES } from '@/constants/ai';
import { queryKeys } from '@/lib/queryClient';
import { track } from '@/lib/observability';
import type { ReidCandidate, SightingLink } from '@/types/ai';

/**
 * Duplicate-sighting detection / cat re-ID (AI-M3 #4). React Query hook that
 * asks the `ai-reid` Edge Function to compute (or reuse) a photo embedding and
 * surface "this might be the same cat as [X]" candidates. The result is a list
 * of SUGGESTIONS — never auto-merges. The caller (ReidSuggestions) surfaces each
 * candidate for the user to confirm/reject.
 *
 * Gated behind `AI_FEATURES.reid`: when false the query is disabled and the UI
 * renders nothing. `staleTime` is short (60s) so a just-reported duplicate shows
 * up quickly, but we don't hammer the model on every screen focus — the edge
 * function caches the embedding so repeated calls within the stale window are
 * cheap DB-only queries.
 */
export function useReidCandidates(sightingId: string, canManage: boolean) {
  return useQuery<ReidCandidate[], Error>({
    queryKey: queryKeys.reidCandidates(sightingId),
    queryFn: () => getReidCandidates(sightingId),
    // Gated on canManage: the ai-reid edge function 403s everyone except the
    // reporter/guardian, so firing it for other viewers is guaranteed failure
    // noise (3 invocations per view with the default retry) for a component
    // that renders null in that state anyway.
    enabled: !!sightingId && canManage && AI_FEATURES.reid,
    staleTime: 60_000,
  });
}

/**
 * Confirm a suggested sighting link — "yes, this is the same cat." Invalidates
 * the re-ID candidates query so the UI updates. Instruments
 * `ai_reid_link_confirmed` on success.
 */
export function useConfirmSightingLink(sightingId: string) {
  const qc = useQueryClient();
  return useMutation<SightingLink, Error, string>({
    mutationFn: (linkId) => confirmSightingLink(linkId),
    onSuccess: (_result, linkId) => {
      track('ai_reid_link_confirmed', { sightingId, linkId });
      qc.invalidateQueries({ queryKey: queryKeys.reidCandidates(sightingId) });
      // A newly confirmed link changes the journey of every sighting in the
      // chain — invalidate the whole family, not just this sighting's key.
      qc.invalidateQueries({ queryKey: ['ai', 'journey'] });
    },
  });
}

/**
 * Reject a suggested (or previously confirmed) sighting link — "no, not the
 * same cat." Invalidates the re-ID candidates query so the UI updates.
 * Instruments `ai_reid_link_rejected` on success.
 */
export function useRejectSightingLink(sightingId: string) {
  const qc = useQueryClient();
  return useMutation<SightingLink, Error, string>({
    mutationFn: (linkId) => rejectSightingLink(linkId),
    onSuccess: (_result, linkId) => {
      track('ai_reid_link_rejected', { sightingId, linkId });
      qc.invalidateQueries({ queryKey: queryKeys.reidCandidates(sightingId) });
      // Rejecting a previously confirmed link removes a journey stop.
      qc.invalidateQueries({ queryKey: ['ai', 'journey'] });
    },
  });
}
