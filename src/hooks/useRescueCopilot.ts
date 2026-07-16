import { useMutation } from '@tanstack/react-query';

import { askRescueCopilot } from '@/api/aiRag';
import { getErrorMessage } from '@/lib/errors';
import { track } from '@/lib/observability';
import type { AskCopilotInput, RescueCopilotAnswer } from '@/types/aiRag';

/**
 * Rescue copilot (AI-M5 #7). React Query mutation that asks the
 * `ai-rescue-copilot` Edge Function a RAG-grounded question about approaching,
 * trapping, or transporting the cat on a claimed sighting. The server verifies
 * the caller is the sighting's assigned guardian; this hook just sends the
 * question and surfaces the (possibly-deferred) answer.
 *
 * Instruments `ai_rescue_copilot_asked` with `{ hasMatch }` on success (so the
 * founder can see what fraction of questions the KB actually answered vs.
 * deferred — a high deferral rate is the signal to curate more KB content),
 * and `ai_rescue_copilot_failed` on a transport / auth / rate-limit error.
 */
export function useRescueCopilot() {
  return useMutation<RescueCopilotAnswer, Error, AskCopilotInput>({
    mutationFn: (input) => askRescueCopilot(input),
    onSuccess: (result) => {
      track('ai_rescue_copilot_asked', { hasMatch: result.hasMatch });
    },
    onError: (error) => {
      track('ai_rescue_copilot_failed', { message: getErrorMessage(error) });
    },
  });
}
