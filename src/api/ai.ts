import { supabase } from '@/lib/supabase';
import type { CatTemperament } from '@/types/models';
import type { AdoptionDraft, ReportAutofillInput, ReportAutofillSuggestion } from '@/types/ai';

const TEMPERAMENTS: readonly CatTemperament[] = ['friendly', 'shy', 'feral', 'unknown'];

/** The raw (snake_case) suggestion shape the edge function returns. */
interface RawSuggestion {
  title?: string;
  description?: string;
  color?: string;
  marks?: string;
  temperament?: string;
  is_injured?: boolean;
}

/**
 * Ask the `ai-report-autofill` Edge Function to suggest report fields from a
 * single base64 cat photo. Server-side only — no model key touches the client
 * (AI_ROADMAP principle 1). The result is an EDITABLE suggestion: callers must
 * prefill the form with it and let the user review/submit, never feed it
 * straight into createSighting.
 *
 * Throws on transport/auth failures and on server-side rate limiting (the edge
 * function returns a non-2xx status, which supabase-js surfaces as `error`).
 */
export async function getReportAutofill(
  input: ReportAutofillInput,
): Promise<ReportAutofillSuggestion> {
  const { data, error } = await supabase.functions.invoke<{ suggestion: RawSuggestion }>(
    'ai-report-autofill',
    { body: { imageBase64: input.imageBase64, mediaType: input.mediaType } },
  );
  if (error) throw error;
  const raw = data?.suggestion;
  if (!raw) throw new Error('No suggestion returned.');
  return normalize(raw);
}

/**
 * Ask the `ai-adoption-copy` Edge Function to draft a warm, community-voiced
 * adoption listing for a sighting from its real rescue timeline (AI-M1 #13).
 * Server-side only — no model key touches the client (AI_ROADMAP principle 1),
 * and the server reads the sighting's data itself; the client sends only the id.
 *
 * The result is an EDITABLE draft: callers must show it for review and let the
 * user save it via the existing description-update path, never auto-publish it.
 * Throws on transport/auth failures and on server-side rate limiting (the edge
 * function returns a non-2xx status, which supabase-js surfaces as `error`).
 */
export async function getAdoptionDraft(sightingId: string): Promise<AdoptionDraft> {
  const { data, error } = await supabase.functions.invoke<{ draft?: string }>('ai-adoption-copy', {
    body: { sighting_id: sightingId },
  });
  if (error) throw error;
  const draft = typeof data?.draft === 'string' ? data.draft.trim() : '';
  if (!draft) throw new Error('No draft returned.');
  return { draft };
}

function normalize(raw: RawSuggestion): ReportAutofillSuggestion {
  const temperament = TEMPERAMENTS.includes(raw.temperament as CatTemperament)
    ? (raw.temperament as CatTemperament)
    : 'unknown';
  return {
    title: typeof raw.title === 'string' ? raw.title : '',
    description: typeof raw.description === 'string' ? raw.description : '',
    color: typeof raw.color === 'string' ? raw.color : '',
    marks: typeof raw.marks === 'string' ? raw.marks : '',
    temperament,
    isInjured: raw.is_injured === true,
  };
}
