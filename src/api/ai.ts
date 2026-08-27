import { supabase } from '@/lib/supabase';
import type { CatTemperament } from '@/types/models';
import type {
  AdoptionDraft,
  CreateLostCatInput,
  LostCat,
  LostCatMatch,
  LostCatStatus,
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

/**
 * Ask the `ai-mod-copilot` Edge Function for an ADVISORY briefing on one queue
 * item (AI-M2 #11). The function is READ-ONLY and `is_moderator()`-gated; the
 * `recommendedAction` it returns is a suggestion the moderator may act on via
 * the existing hide/dismiss controls — it never acts on its own.
 *
 * The wire contract is snake_case on both directions (`target_type`/`target_id`
 * in, `{summary, user_history, recommended_action, rationale}` out), so this
 * maps to/from the camelCase `ModCopilotInput`/`ModCopilotSummary` types here.
 */
export async function getModCopilotSummary(input: ModCopilotInput): Promise<ModCopilotSummary> {
  const { data, error } = await supabase.functions.invoke<{
    summary?: string;
    user_history?: string;
    recommended_action?: string;
    rationale?: string;
  }>('ai-mod-copilot', {
    body: { target_type: input.targetType, target_id: input.targetId },
  });
  if (error) throw error;
  if (!data) throw new Error('No copilot summary returned.');
  const actions: readonly ModCopilotSummary['recommendedAction'][] = ['hide', 'dismiss', 'review'];
  const action = actions.includes(data.recommended_action as ModCopilotSummary['recommendedAction'])
    ? (data.recommended_action as ModCopilotSummary['recommendedAction'])
    : 'review';
  return {
    summary: typeof data.summary === 'string' ? data.summary : '',
    userHistory: typeof data.user_history === 'string' ? data.user_history : '',
    recommendedAction: action,
  };
}

// ── re-ID links + lost cats: CRUD via RPC, AI pipeline via Edge Function ────
//
// Split of responsibilities (do not blur it again):
//   * Every CRUD operation is a SECURITY DEFINER RPC from migrations 0023
//     (sighting_links) / 0025 (lost_cats), granted to `authenticated`. Those go
//     straight to `supabase.rpc` — the edge functions implement no CRUD
//     protocol and 400 on anything but their own body shape.
//   * The `ai-reid` / `ai-lost-match` Edge Functions are the AI/embedding
//     pipeline ONLY: they hold the server-side model keys and are the ONLY way
//     to compute embeddings + candidate matches. Calling them for reads spends
//     real model money.
//
// Those RPCs post-date the last `npm run gen:types` run, so they are invoked
// through a minimally-typed RPC surface (the same boundary cast src/api/push.ts
// uses). Nothing untyped escapes this module: every row that crosses the
// boundary goes through an explicit snake_case → camelCase mapper below.

interface RpcResult<T> {
  data: T | null;
  error: Error | null;
}

function rpc<T>(fn: string, args: Record<string, unknown>): Promise<RpcResult<T>> {
  const call = supabase.rpc as unknown as (
    this: typeof supabase,
    fn: string,
    args: Record<string, unknown>,
  ) => Promise<RpcResult<T>>;
  return call.call(supabase, fn, args);
}

/** `sighting_links` row / `get_sighting_links` (0023) result row. */
interface SightingLinkRow {
  id: string;
  sighting_id: string;
  linked_sighting_id: string;
  confidence: number | null;
  status: string;
  created_at?: string;
  /** get_sighting_links only — the OTHER sighting's display fields. */
  title?: string | null;
  thumbnail_url?: string | null;
}

/** `lost_cats` row / `get_my_lost_cats` row / `get_lost_cat` jsonb (0025). */
interface LostCatRow {
  id: string;
  owner_id: string;
  title: string | null;
  description: string | null;
  photo_url: string | null;
  lat: number;
  lng: number;
  last_seen_at: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

/** `lost_cat_matches` row / `get_lost_cat_matches` result row (0025). */
interface LostCatMatchRow {
  id: string;
  lost_cat_id: string;
  sighting_id: string;
  confidence: number | null;
  status: string;
  created_at: string;
  /** get_lost_cat_matches only — computed/joined display fields. */
  distance_m?: number | null;
  sighting_title?: string | null;
  sighting_thumbnail_url?: string | null;
  sighting_created_at?: string | null;
}

/**
 * `ai-reid`'s `DuplicateCandidate` (functions/ai-reid/index.ts:65-74). Note it
 * carries NO `sighting_id` — the caller's own id is threaded through.
 */
interface ReidCandidateRow {
  linked_sighting_id: string;
  title?: string | null;
  thumbnail_url?: string | null;
  status?: string;
  created_at?: string;
  distance_m?: number | null;
  confidence?: number | null;
  link_id?: string | null;
}

const LINK_STATUSES = ['suggested', 'confirmed', 'rejected'] as const;
type LinkStatus = (typeof LINK_STATUSES)[number];

/** DB `status` is plain `text`; coerce anything unexpected to 'suggested'. */
function toLinkStatus(value: unknown): LinkStatus {
  return LINK_STATUSES.includes(value as LinkStatus) ? (value as LinkStatus) : 'suggested';
}

const LOST_CAT_STATUSES = ['open', 'matched', 'closed'] as const;

function toLostCatStatus(value: unknown): LostCatStatus {
  return LOST_CAT_STATUSES.includes(value as LostCatStatus) ? (value as LostCatStatus) : 'open';
}

function toSightingLink(row: SightingLinkRow): SightingLink {
  return {
    id: row.id,
    sightingId: row.sighting_id,
    linkedSightingId: row.linked_sighting_id,
    confidence: row.confidence ?? 0,
    status: toLinkStatus(row.status),
  };
}

function toLostCat(row: LostCatRow): LostCat {
  return {
    id: row.id,
    // The DB column is `owner_id`; the client type has always called it user_id.
    user_id: row.owner_id,
    title: row.title ?? '',
    description: row.description ?? null,
    photoUrl: row.photo_url ?? null,
    // `lat`/`lng` on the server — precise for the owner, ~110m-coarsened for
    // everyone else (get_lost_cat decides; the client never widens precision).
    lastSeenLat: row.lat,
    lastSeenLng: row.lng,
    lastSeenAt: row.last_seen_at ?? null,
    status: toLostCatStatus(row.status),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function toLostCatMatch(row: LostCatMatchRow): LostCatMatch {
  return {
    id: row.id,
    lost_cat_id: row.lost_cat_id,
    sighting_id: row.sighting_id,
    confidence: row.confidence ?? 0,
    status: toLinkStatus(row.status),
    created_at: row.created_at,
    createdAt: row.created_at,
    sightingTitle: row.sighting_title ?? null,
    sightingThumbnailUrl: row.sighting_thumbnail_url ?? null,
    distanceM: typeof row.distance_m === 'number' ? row.distance_m : undefined,
    sightingCreatedAt: row.sighting_created_at ?? undefined,
  };
}

function toReidCandidate(row: ReidCandidateRow, sightingId: string): ReidCandidate {
  return {
    linkId: row.link_id ?? null,
    // The server row describes only the OTHER side of the pair, so the caller's
    // sighting id is threaded through rather than read from the payload.
    sightingId,
    linkedSightingId: row.linked_sighting_id,
    confidence: typeof row.confidence === 'number' ? row.confidence : 0,
    status: toLinkStatus(row.status),
    title: row.title ?? null,
    thumbnailUrl: row.thumbnail_url ?? null,
    distanceM: typeof row.distance_m === 'number' ? row.distance_m : undefined,
  };
}

/**
 * Duplicate-sighting detection / cat re-ID (AI-M3 #4). This is the ONE call in
 * this group that legitimately hits an Edge Function: `ai-reid` computes (or
 * reuses) the photo embedding server-side and returns nearest-neighbour
 * candidates. It is PAID work — never call it for a plain read.
 *
 * `ai-reid` answers with an ENVELOPE (`{ candidates: [...] }`, index.ts:135 and
 * :318) of snake_case rows, so the envelope is unwrapped defensively: a
 * missing/malformed payload yields an empty list rather than handing a
 * non-array to the caller's `.map`.
 */
export async function getReidCandidates(sightingId: string): Promise<ReidCandidate[]> {
  const { data, error } = await supabase.functions.invoke<{ candidates?: unknown }>('ai-reid', {
    body: { sighting_id: sightingId },
  });
  if (error) throw error;
  const payload = (data ?? {}) as { candidates?: unknown };
  const rows: unknown[] = Array.isArray(payload.candidates) ? payload.candidates : [];
  return rows
    .filter((row): row is ReidCandidateRow => typeof row === 'object' && row !== null)
    .map((row) => toReidCandidate(row, sightingId));
}

/** Confirm a suggested link — "same cat." Reversible (0023). */
export async function confirmSightingLink(linkId: string): Promise<SightingLink> {
  const { data, error } = await rpc<SightingLinkRow>('confirm_sighting_link', { p_link: linkId });
  if (error) throw error;
  if (!data) throw new Error('No link returned.');
  return toSightingLink(data);
}

/** Reject a suggested (or previously confirmed) link — "different cat" (0023). */
export async function rejectSightingLink(linkId: string): Promise<SightingLink> {
  const { data, error } = await rpc<SightingLinkRow>('reject_sighting_link', { p_link: linkId });
  if (error) throw error;
  if (!data) throw new Error('No link returned.');
  return toSightingLink(data);
}

/**
 * The suggested + confirmed links for a sighting (0023). A plain read — it must
 * NEVER go through `ai-reid`, which would re-run the paid embedding pipeline.
 */
export async function getSightingLinks(sightingId: string): Promise<SightingLink[]> {
  const { data, error } = await rpc<SightingLinkRow[]>('get_sighting_links', {
    p_sighting: sightingId,
  });
  if (error) throw error;
  return (Array.isArray(data) ? data : []).map(toSightingLink);
}

/**
 * Create a lost-cat post (0025). The RPC builds the PostGIS point server-side
 * from p_lat/p_lng and requires a non-null `p_last_seen_at`, so an omitted
 * last-seen time defaults to now (what the form's placeholder promises).
 */
export async function createLostCat(input: CreateLostCatInput): Promise<LostCat> {
  const { data, error } = await rpc<LostCatRow>('create_lost_cat', {
    p_lat: input.lat,
    p_lng: input.lng,
    p_last_seen_at: input.lastSeenAt ?? new Date().toISOString(),
    p_title: input.title ?? null,
    p_description: input.description ?? null,
    p_photo_url: input.photoUrl ?? null,
  });
  if (error) throw error;
  if (!data) throw new Error('No lost cat returned.');
  return toLostCat(data);
}

/** The caller's own lost-cat posts, precise coordinates, newest first (0025). */
export async function getMyLostCats(): Promise<LostCat[]> {
  const { data, error } = await rpc<LostCatRow[]>('get_my_lost_cats', {});
  if (error) throw error;
  return (Array.isArray(data) ? data : []).map(toLostCat);
}

/** A single lost-cat post — coarsened for non-owners by the RPC itself (0025). */
export async function getLostCat(id: string): Promise<LostCat> {
  const { data, error } = await rpc<LostCatRow>('get_lost_cat', { p_id: id });
  if (error) throw error;
  if (!data) throw new Error('No lost cat returned.');
  return toLostCat(data);
}

/** Suggested + confirmed matches for a lost-cat post (0025). */
export async function getLostCatMatches(lostCatId: string): Promise<LostCatMatch[]> {
  const { data, error } = await rpc<LostCatMatchRow[]>('get_lost_cat_matches', {
    p_lost_cat: lostCatId,
  });
  if (error) throw error;
  return (Array.isArray(data) ? data : []).map(toLostCatMatch);
}

/** Owner confirms "that's my cat" — flips the post to `matched` (0025). */
export async function confirmLostCatMatch(matchId: string): Promise<LostCatMatch> {
  const { data, error } = await rpc<LostCatMatchRow>('confirm_lost_cat_match', {
    p_match: matchId,
  });
  if (error) throw error;
  if (!data) throw new Error('No match returned.');
  return toLostCatMatch(data);
}

/** Owner rejects a match — "not them." Reversible; post stays open (0025). */
export async function rejectLostCatMatch(matchId: string): Promise<LostCatMatch> {
  const { data, error } = await rpc<LostCatMatchRow>('reject_lost_cat_match', { p_match: matchId });
  if (error) throw error;
  if (!data) throw new Error('No match returned.');
  return toLostCatMatch(data);
}

/**
 * Run the lost-cat matching pipeline for a new post (AI-M4 #5). AI work, so it
 * IS an edge-function call — `ai-lost-match` requires
 * `mode: 'lost_cat' | 'sighting'` (functions/ai-lost-match/index.ts:142-150)
 * and 400s without it.
 */
export async function triggerLostCatMatch(lostCatId: string): Promise<void> {
  const { error } = await supabase.functions.invoke('ai-lost-match', {
    body: { mode: 'lost_cat', lost_cat_id: lostCatId },
  });
  if (error) throw error;
}

/** The other direction: match a NEW sighting against open lost-cat posts. */
export async function triggerSightingLostMatch(sightingId: string): Promise<void> {
  const { error } = await supabase.functions.invoke('ai-lost-match', {
    body: { mode: 'sighting', sighting_id: sightingId },
  });
  if (error) throw error;
}
