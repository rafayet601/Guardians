import { supabase } from '@/lib/supabase';
import type { AskCopilotInput, RescueCopilotAnswer, RescueCopilotSource } from '@/types/aiRag';

/**
 * Ask the `ai-rescue-copilot` Edge Function (AI-M5 #7) a RAG-grounded question
 * about approaching, humane trapping, or safe transport of the cat on a
 * sighting the current user is the assigned guardian for. Server-side only —
 * no model key touches the client (AI_ROADMAP principle 1), and the server
 * re-checks `claimed_by === auth.uid()` so a non-claimer can never reach the
 * model regardless of what the client hides.
 *
 * Returns `{ answer, sources, hasMatch }`. `hasMatch: false` means the KB had
 * no close-enough chunk for the question — the copilot deferred to a vet /
 * animal services instead of guessing. Surface that case prominently.
 *
 * Throws on transport / auth / rate-limit failures (the edge function returns
 * a non-2xx status, which supabase-js surfaces as `error`).
 *
 * Lives in its own feature module (`@/api/aiRag`) — the shared `@/api/ai` barrel
 * is edited by a parallel agent and is intentionally untouched here.
 */
export async function askRescueCopilot(input: AskCopilotInput): Promise<RescueCopilotAnswer> {
  const { data, error } = await supabase.functions.invoke<RawCopilotResponse>('ai-rescue-copilot', {
    body: { sighting_id: input.sightingId, question: input.question },
  });
  if (error) throw error;

  const answer = typeof data?.answer === 'string' ? data.answer.trim() : '';
  if (!answer) throw new Error('No answer returned.');

  const sources: RescueCopilotSource[] = Array.isArray(data?.sources)
    ? data.sources
        .map((s) => ({
          title: typeof s?.title === 'string' ? s.title : '',
          source: typeof s?.source === 'string' ? s.source : '',
          snippet: typeof s?.snippet === 'string' ? s.snippet : '',
        }))
        .filter((s) => s.title || s.source)
    : [];

  return {
    answer,
    sources,
    hasMatch: data?.has_match === true,
  };
}

/** Raw (snake_case) response shape of the `ai-rescue-copilot` edge function. */
interface RawCopilotResponse {
  answer?: string;
  sources?: { title?: string; source?: string; snippet?: string }[];
  has_match?: boolean;
}
