/**
 * Best-effort, fire-and-forget AI content screening (AI-M2 #9 photo / #10 text),
 * plus the moderator copilot mutation (#11, see useModCopilot below).
 *
 * The screening helpers are deliberately NOT React Query mutations: screening is a
 * background side effect of posting content, never something the UI waits on.
 * Each helper:
 *   - no-ops instantly unless its AI_FEATURES flag is on (flags default off);
 *   - swallows every error — a moderation hiccup must NEVER block or fail the
 *     user's report/comment (there is no UI to update on failure);
 *   - only instruments `track(...)` events for observability.
 *
 * All real consequences happen server-side in the EXISTING moderation system
 * (abuse_reports queue, migration 0012): a confident violation auto-hides
 * (never deletes) pending human review; borderline only enqueues. Nothing
 * client-side can ban, delete, or suspend anyone (ai-safety-agent charter).
 */
import { useMutation } from '@tanstack/react-query';

import { getModCopilotSummary, moderatePhoto, moderateText } from '@/api/ai';
import { AI_FEATURES } from '@/constants/ai';
import { track } from '@/lib/observability';
import type { ModCopilotInput } from '@/types/ai';

/**
 * Screen one just-uploaded sighting photo in the background. Call after the
 * photo is uploaded AND its sighting exists (the server verifies the caller is
 * the sighting's reporter). Fire-and-forget: `void screenPhotoBestEffort(...)`.
 */
export async function screenPhotoBestEffort(input: {
  imageBase64: string;
  mediaType?: string;
  sightingId: string;
}): Promise<void> {
  if (!AI_FEATURES.photoModeration) return;
  try {
    const result = await moderatePhoto({
      imageBase64: input.imageBase64,
      mediaType: input.mediaType,
      target: { type: 'sighting_photo', id: input.sightingId },
    });
    track('ai_photo_moderation_ran', {
      verdict: result.verdict,
      categories: result.categories,
      applied: result.applied,
    });
  } catch {
    // Best-effort by contract: moderation must never surface an error to the
    // reporting flow. Server-side logs/usage ledger capture failures.
    track('ai_photo_moderation_failed');
  }
}

/**
 * Screen a just-posted comment in the background. The server re-reads the
 * canonical text by id, so this is safe to call with the local copy.
 * Fire-and-forget: `void screenCommentBestEffort(id, body)`.
 */
/**
 * Moderator copilot (AI-M2 #11) — on-demand briefing for ONE queue item in
 * app/moderation.tsx. Unlike the screeners above this IS a React Query
 * mutation: the moderator explicitly taps "AI summary" and waits for the
 * result. The server is READ-ONLY and is_moderator()-gated; the returned
 * recommendation is a suggestion the moderator acts on (or not) via the
 * existing Hide/Dismiss buttons. Callers must gate on AI_FEATURES.modCopilot.
 */
export function useModCopilot() {
  return useMutation({
    mutationFn: (input: ModCopilotInput) => getModCopilotSummary(input),
    onSuccess: (data, input) => {
      track('ai_mod_copilot_ran', {
        target_type: input.targetType,
        recommended_action: data.recommendedAction,
      });
    },
    onError: () => {
      track('ai_mod_copilot_failed');
    },
  });
}

export async function screenCommentBestEffort(commentId: string, text: string): Promise<void> {
  if (!AI_FEATURES.textModeration) return;
  try {
    const result = await moderateText({ type: 'comment', id: commentId, text });
    track('ai_text_moderation_ran', {
      verdict: result.verdict,
      categories: result.categories,
      applied: result.applied,
    });
  } catch {
    // Best-effort by contract — never block or fail the comment on this.
    track('ai_text_moderation_failed');
  }
}
