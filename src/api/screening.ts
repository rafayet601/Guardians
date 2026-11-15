import { Buffer } from 'buffer';

import { supabase } from '@/lib/supabase';
import type { Json } from '@/types/database';
import type { AdopterScreening, ScreeningPayload } from '@/types/models';

/** Owner-only read of my background-check screening (PII never lister-visible). */
export async function getMyScreening(): Promise<AdopterScreening | null> {
  const { data, error } = await supabase.rpc('get_my_screening');
  if (error) throw error;
  // A composite-returning RPC answers "no row" with an all-null record.
  const row = data as unknown as AdopterScreening | null;
  return row?.id ? row : null;
}

/** Submit (or re-submit) my screening questionnaire. Runs server-side scoring. */
export async function submitScreening(payload: ScreeningPayload): Promise<AdopterScreening> {
  const { data, error } = await supabase.rpc('submit_adopter_screening', {
    p_payload: payload as unknown as Json,
  });
  if (error) throw error;
  return data as unknown as AdopterScreening;
}

/** Boolean only — safe to call for listers reviewing applicants (no PII). */
export async function isAdopterCleared(userId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('is_adopter_cleared', { p_user: userId });
  if (error) throw error;
  return !!data;
}

export interface VerifyStart {
  provider: string;
  status: string;
  session_id?: string;
  message?: string;
}

/** Kick off ID verification for my screening (manual review queue in v1). */
export async function startIdVerification(idDocPaths: string[]): Promise<VerifyStart> {
  const { data, error } = await supabase.functions.invoke<VerifyStart>('screening-verify', {
    body: { id_doc_paths: idDocPaths },
  });
  if (error) throw error;
  if (!data) throw new Error('No response from verification service.');
  return data;
}

// ── Moderator review (migration 0038) ────────────────────────────────────────

/** One applicant waiting for review: what a reviewer needs, no phone or street address. */
export interface ScreeningReviewItem {
  user_id: string;
  username: string;
  status: 'pending' | 'needs_review';
  id_status: string;
  full_name: string;
  dob: string;
  age: number;
  city: string;
  postal: string;
  housing: 'own' | 'rent' | 'other';
  landlord_permission: boolean | null;
  household_adults: number;
  household_children: number;
  other_pets: boolean;
  pets_details: string | null;
  vet_name: string | null;
  vet_phone: string | null;
  experience: string | null;
  hours_alone: number;
  home_visit_consent: boolean;
  cruelty_attestation: boolean;
  score: number;
  reasons: string[];
  id_doc_paths: string[];
  submitted_at: string;
}

export type ScreeningDecision = 'approved' | 'needs_review' | 'rejected';

/** Moderators only: applicants waiting for review, oldest first. */
export async function getScreeningQueue(): Promise<ScreeningReviewItem[]> {
  const { data, error } = await supabase.rpc('list_screening_queue');
  if (error) throw error;
  // The generator types every returned column as non-null; the nullable ones
  // are corrected by ScreeningReviewItem.
  return (data ?? []) as unknown as ScreeningReviewItem[];
}

/** Moderators only. A reason is required for anything but approval. */
export async function reviewScreening(
  userId: string,
  decision: ScreeningDecision,
  reason?: string,
): Promise<void> {
  const { error } = await supabase.rpc('review_adopter_screening', {
    p_user: userId,
    p_decision: decision,
    p_reason: reason?.trim() || undefined,
  });
  if (error) throw error;
}

/** How long a reviewer's link to an ID photo works. */
export const ID_PHOTO_URL_TTL_S = 600;

/**
 * Short-lived links to an applicant's ID photos for review. The bucket stays
 * private; only moderators (and the owner) may sign these.
 */
export async function getScreeningDocUrls(paths: string[]): Promise<string[]> {
  if (paths.length === 0) return [];
  const { data, error } = await supabase.storage
    .from('screening-docs')
    .createSignedUrls(paths, ID_PHOTO_URL_TTL_S);
  if (error) throw error;
  return (data ?? []).flatMap((d) => (d.signedUrl ? [d.signedUrl] : []));
}

export interface ScreeningLocalAsset {
  uri: string;
  mimeType?: string | null;
  base64?: string | null;
}

/** Matches the screening-docs bucket limit; checked before allocating decoded data. */
export const MAX_SCREENING_DOC_BYTES = 10 * 1024 * 1024;
const SCREENING_IMAGE_EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif',
};

function screeningImageMime(bytes: Buffer): string | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return 'image/jpeg';
  if (
    bytes.length >= 8 &&
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((byte, index) => bytes[index] === byte)
  )
    return 'image/png';
  if (
    bytes.length >= 12 &&
    bytes.toString('ascii', 0, 4) === 'RIFF' &&
    bytes.toString('ascii', 8, 12) === 'WEBP'
  )
    return 'image/webp';
  if (bytes.length >= 12 && bytes.toString('ascii', 4, 8) === 'ftyp') {
    const brand = bytes.toString('ascii', 8, 12);
    if (['heic', 'heix', 'hevc', 'hevx'].includes(brand)) return 'image/heic';
    if (['mif1', 'msf1'].includes(brand)) return 'image/heif';
  }
  return null;
}

/**
 * Upload an ID document image into the private `screening-docs` bucket under
 * "{uid}/..." and return its storage path for `id_doc_paths`. Private bucket:
 * no public URL — moderators/providers read via service role only.
 */
export async function uploadScreeningDoc(
  userId: string,
  asset: ScreeningLocalAsset,
): Promise<string> {
  if (!asset.base64) {
    throw new Error('Document is missing data — please pick the photo again.');
  }
  if (asset.base64.length > Math.ceil(MAX_SCREENING_DOC_BYTES / 3) * 4)
    throw new Error('Please choose an ID photo no larger than 10 MiB.');
  const paddingAt = asset.base64.indexOf('=');
  if (
    asset.base64.length % 4 !== 0 ||
    /[^A-Za-z0-9+/=]/.test(asset.base64) ||
    (paddingAt >= 0 &&
      (paddingAt < asset.base64.length - 2 || !/^={1,2}$/.test(asset.base64.slice(paddingAt))))
  )
    throw new Error('Document data could not be read — please pick the photo again.');
  const declaredMime = asset.mimeType?.toLowerCase();
  if (declaredMime && !Object.hasOwn(SCREENING_IMAGE_EXTENSIONS, declaredMime))
    throw new Error('Please choose a JPEG, PNG, WebP, HEIC or HEIF ID photo.');
  const bytes = Buffer.from(asset.base64, 'base64');
  if (!bytes.length || bytes.length > MAX_SCREENING_DOC_BYTES)
    throw new Error('Please choose an ID photo no larger than 10 MiB.');
  // SDK 57 ImagePicker can return JPEG base64 with the original HEIC MIME.
  // Use the payload signature for its content type and filename, rather than
  // uploading JPEG bytes as HEIC. This is a format check, not an image decoder.
  const mime = screeningImageMime(bytes);
  if (!mime) throw new Error('Document image could not be read — please pick the photo again.');
  const ext = SCREENING_IMAGE_EXTENSIONS[mime];
  const path = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error } = await supabase.storage
    .from('screening-docs')
    .upload(path, bytes, { contentType: mime, upsert: false });
  if (error) throw error;
  return path;
}
