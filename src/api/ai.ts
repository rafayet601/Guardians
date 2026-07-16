import { supabase } from '@/lib/supabase';
import type { CatTemperament } from '@/types/models';
import type {
  AdoptionDraft,
  CreateLostCatInput,
  LostCat,
  LostCatMatch,
  ModCopilotInput,
  ModCopilotSummary,
  ModeratePhotoInput,
  ModerateTextInput,
  ModerationResult,
  ReidCandidate,
  ReportAutofillInput,
  ReportAutofillSuggestion,
  SightingLink,
} from '@/types/ai';

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

export async function moderatePhoto(input: ModeratePhotoInput): Promise<ModerationResult> {
  const { data, error } = await supabase.functions.invoke<ModerationResult>('ai-moderate-photo', {
    body: input,
  });
  if (error) throw error;
  if (!data) throw new Error('No moderation result returned.');
  return data;
}

export async function moderateText(input: ModerateTextInput): Promise<ModerationResult> {
  const { data, error } = await supabase.functions.invoke<ModerationResult>('ai-moderate-text', {
    body: input,
  });
  if (error) throw error;
  if (!data) throw new Error('No moderation result returned.');
  return data;
}

export async function getModCopilotSummary(input: ModCopilotInput): Promise<ModCopilotSummary> {
  const { data, error } = await supabase.functions.invoke<ModCopilotSummary>('ai-mod-copilot', {
    body: input,
  });
  if (error) throw error;
  if (!data) throw new Error('No copilot summary returned.');
  return data;
}

export async function getReidCandidates(sightingId: string): Promise<ReidCandidate[]> {
  const { data, error } = await supabase.functions.invoke<ReidCandidate[]>('ai-reid', {
    body: { sighting_id: sightingId },
  });
  if (error) throw error;
  return data ?? [];
}

export async function confirmSightingLink(linkId: string): Promise<SightingLink> {
  const { data, error } = await supabase.functions.invoke<SightingLink>('ai-reid', {
    body: { link_id: linkId, action: 'confirm' },
  });
  if (error) throw error;
  if (!data) throw new Error('No link returned.');
  return data;
}

export async function rejectSightingLink(linkId: string): Promise<SightingLink> {
  const { data, error } = await supabase.functions.invoke<SightingLink>('ai-reid', {
    body: { link_id: linkId, action: 'reject' },
  });
  if (error) throw error;
  if (!data) throw new Error('No link returned.');
  return data;
}

export async function getSightingLinks(sightingId: string): Promise<SightingLink[]> {
  const { data, error } = await supabase.functions.invoke<SightingLink[]>('ai-reid', {
    body: { sighting_id: sightingId, action: 'list' },
  });
  if (error) throw error;
  return data ?? [];
}

export async function createLostCat(input: CreateLostCatInput): Promise<LostCat> {
  const { data, error } = await supabase.functions.invoke<LostCat>('ai-lost-match', {
    body: { ...input, action: 'create' },
  });
  if (error) throw error;
  if (!data) throw new Error('No lost cat returned.');
  return data;
}

export async function getMyLostCats(): Promise<LostCat[]> {
  const { data, error } = await supabase.functions.invoke<LostCat[]>('ai-lost-match', {
    body: { action: 'list_mine' },
  });
  if (error) throw error;
  return data ?? [];
}

export async function getLostCat(id: string): Promise<LostCat> {
  const { data, error } = await supabase.functions.invoke<LostCat>('ai-lost-match', {
    body: { id, action: 'get' },
  });
  if (error) throw error;
  if (!data) throw new Error('No lost cat returned.');
  return data;
}

export async function getLostCatMatches(lostCatId: string): Promise<LostCatMatch[]> {
  const { data, error } = await supabase.functions.invoke<LostCatMatch[]>('ai-lost-match', {
    body: { lost_cat_id: lostCatId, action: 'list_matches' },
  });
  if (error) throw error;
  return data ?? [];
}

export async function confirmLostCatMatch(matchId: string): Promise<LostCatMatch> {
  const { data, error } = await supabase.functions.invoke<LostCatMatch>('ai-lost-match', {
    body: { match_id: matchId, action: 'confirm_match' },
  });
  if (error) throw error;
  if (!data) throw new Error('No match returned.');
  return data;
}

export async function rejectLostCatMatch(matchId: string): Promise<LostCatMatch> {
  const { data, error } = await supabase.functions.invoke<LostCatMatch>('ai-lost-match', {
    body: { match_id: matchId, action: 'reject_match' },
  });
  if (error) throw error;
  if (!data) throw new Error('No match returned.');
  return data;
}

export async function triggerLostCatMatch(lostCatId: string): Promise<void> {
  const { error } = await supabase.functions.invoke('ai-lost-match', {
    body: { lost_cat_id: lostCatId, action: 'trigger_match' },
  });
  if (error) throw error;
}

export async function triggerSightingLostMatch(sightingId: string): Promise<void> {
  const { error } = await supabase.functions.invoke('ai-lost-match', {
    body: { sighting_id: sightingId, action: 'trigger_sighting_match' },
  });
  if (error) throw error;
}
