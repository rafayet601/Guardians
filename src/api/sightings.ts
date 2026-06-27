import { supabase } from '@/lib/supabase';
import type {
  AdoptionInterest,
  CatStatus,
  CatTemperament,
  NearbySighting,
  Sighting,
  SightingPhoto,
  SightingUpdate,
} from '@/types/models';

// NOTE: lat/lng (and the raw `location`/`address`) are deliberately NOT selected
// here — exact coordinates must never reach non-owners. List/feed UIs don't need
// them, and the single detail view fetches privacy-aware coordinates through the
// `get_sighting_detail` RPC (see getSighting + migration 0009).
const SIGHTING_SELECT = `
  id, reporter_id, title, description, status, temperament, color,
  is_injured, needs_urgent_help, claimed_by, claimed_at, rescued_at,
  created_at, updated_at,
  reporter:profiles!sightings_reporter_id_fkey(id, username, avatar_url, level),
  claimer:profiles!sightings_claimed_by_fkey(id, username, avatar_url, level),
  photos:sighting_photos(id, sighting_id, url, uploaded_by, created_at)
`;

export interface NearbyParams {
  lat: number;
  lng: number;
  radiusM: number;
  statuses?: CatStatus[];
  limit?: number;
}

export async function getNearby(params: NearbyParams): Promise<NearbySighting[]> {
  const { data, error } = await supabase.rpc('nearby_sightings', {
    p_lat: params.lat,
    p_lng: params.lng,
    p_radius_m: params.radiusM,
    p_statuses: params.statuses,
    p_limit: params.limit ?? 200,
  });
  if (error) throw error;
  return (data ?? []) as NearbySighting[];
}

export interface FeedPage {
  items: Sighting[];
  /** created_at of the last row when a full page came back; null when exhausted. */
  nextCursor: string | null;
}

export async function getFeed(
  statuses?: CatStatus[],
  cursor?: string,
  limit = 20,
): Promise<FeedPage> {
  let query = supabase
    .from('sightings')
    .select(SIGHTING_SELECT)
    .neq('status', 'archived')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (statuses && statuses.length) query = query.in('status', statuses);
  if (cursor) query = query.lt('created_at', cursor); // keyset pagination
  const { data, error } = await query;
  if (error) throw error;
  const items = (data ?? []) as unknown as Sighting[];
  const nextCursor = items.length === limit ? items[items.length - 1].created_at : null;
  return { items, nextCursor };
}

export async function getSighting(id: string): Promise<Sighting> {
  // Routed through a SECURITY DEFINER RPC so coordinates (and address) are
  // precise only for the reporter / assigned guardian, coarsened (~110m) for
  // everyone else. Returns an `is_precise` flag for the UI. (migration 0009)
  const { data, error } = await supabase.rpc('get_sighting_detail', { p_sighting: id });
  if (error) throw error;
  return data as unknown as Sighting;
}

export async function getMySightings(userId: string): Promise<Sighting[]> {
  const { data, error } = await supabase
    .from('sightings')
    .select(SIGHTING_SELECT)
    .eq('reporter_id', userId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as Sighting[];
}

export interface CreateSightingInput {
  lat: number;
  lng: number;
  title?: string;
  description?: string;
  temperament?: CatTemperament;
  color?: string;
  isInjured?: boolean;
  needsUrgentHelp?: boolean;
  address?: string;
}

export async function createSighting(input: CreateSightingInput): Promise<Sighting> {
  const { data, error } = await supabase.rpc('create_sighting', {
    p_lat: input.lat,
    p_lng: input.lng,
    p_title: input.title,
    p_description: input.description,
    p_temperament: input.temperament ?? 'unknown',
    p_color: input.color,
    p_is_injured: input.isInjured ?? false,
    p_needs_urgent_help: input.needsUrgentHelp ?? false,
    p_address: input.address,
  });
  if (error) throw error;
  return data as Sighting;
}

export async function addPhoto(
  sightingId: string,
  url: string,
  uploadedBy: string,
): Promise<SightingPhoto> {
  const { data, error } = await supabase
    .from('sighting_photos')
    .insert({ sighting_id: sightingId, url, uploaded_by: uploadedBy })
    .select('*')
    .single();
  if (error) throw error;
  return data as SightingPhoto;
}

export async function getPhotos(sightingId: string): Promise<SightingPhoto[]> {
  const { data, error } = await supabase
    .from('sighting_photos')
    .select('*')
    .eq('sighting_id', sightingId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as SightingPhoto[];
}

export async function claimSighting(id: string): Promise<Sighting> {
  const { data, error } = await supabase.rpc('claim_sighting', { p_sighting: id });
  if (error) throw error;
  return data as Sighting;
}

export async function updateStatus(
  id: string,
  status: CatStatus,
  note?: string,
): Promise<Sighting> {
  const { data, error } = await supabase.rpc('update_sighting_status', {
    p_sighting: id,
    p_new_status: status,
    p_note: note,
  });
  if (error) throw error;
  return data as Sighting;
}

// ── activity timeline ───────────────────────────────────────────────────────

export async function getUpdates(sightingId: string): Promise<SightingUpdate[]> {
  const { data, error } = await supabase
    .from('sighting_updates')
    .select(
      '*, author:profiles!sighting_updates_author_id_fkey(id, username, avatar_url, level)',
    )
    .eq('sighting_id', sightingId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as unknown as SightingUpdate[];
}

export async function postComment(
  sightingId: string,
  authorId: string,
  body: string,
): Promise<SightingUpdate> {
  const { data, error } = await supabase
    .from('sighting_updates')
    .insert({ sighting_id: sightingId, author_id: authorId, type: 'comment', body })
    .select('*')
    .single();
  if (error) throw error;
  return data as SightingUpdate;
}

// ── adoption ────────────────────────────────────────────────────────────────

export async function expressInterest(
  sightingId: string,
  message?: string,
): Promise<AdoptionInterest> {
  const { data, error } = await supabase.rpc('express_adoption_interest', {
    p_sighting: sightingId,
    p_message: message,
  });
  if (error) throw error;
  return data as AdoptionInterest;
}

export async function getAdoptionInterest(sightingId: string): Promise<AdoptionInterest[]> {
  const { data, error } = await supabase
    .from('adoption_interest')
    .select(
      '*, applicant:profiles!adoption_interest_user_id_fkey(id, username, avatar_url, level)',
    )
    .eq('sighting_id', sightingId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as unknown as AdoptionInterest[];
}

export async function approveAdoption(interestId: string): Promise<Sighting> {
  const { data, error } = await supabase.rpc('approve_adoption', { p_interest: interestId });
  if (error) throw error;
  return data as Sighting;
}
