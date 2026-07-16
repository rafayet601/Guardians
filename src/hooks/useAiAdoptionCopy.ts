import { useMutation } from '@tanstack/react-query';

import { getAdoptionDraft } from '@/api/ai';
import { track } from '@/lib/observability';
import type { AdoptionDraft } from '@/types/ai';

/**
 * Adoption profile writer (AI-M1 #13). React Query mutation that asks the
 * `ai-adoption-copy` Edge Function to draft a warm, community-voiced listing for
 * a sighting from its real rescue timeline. Instruments `ai_adoption_copy_used`
 * on success. The caller shows the returned draft for the user to review and
 * edit — it is never wired straight into a publish/update; the user saves it
 * themselves via the existing description-update path.
 */
export function useAiAdoptionCopy() {
  return useMutation<AdoptionDraft, Error, string>({
    mutationFn: (sightingId) => getAdoptionDraft(sightingId),
    onSuccess: (_result, sightingId) => {
      track('ai_adoption_copy_used', { sightingId });
    },
  });
}
