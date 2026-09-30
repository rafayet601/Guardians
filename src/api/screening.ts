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

export interface ScreeningLocalAsset {
  uri: string;
  mimeType?: string | null;
  base64?: string | null;
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
  const bytes = Buffer.from(asset.base64, 'base64');
  const mime = asset.mimeType ?? 'image/jpeg';
  const ext = mime.includes('png') ? 'png' : mime.includes('webp') ? 'webp' : 'jpg';
  const path = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error } = await supabase.storage
    .from('screening-docs')
    .upload(path, bytes, { contentType: mime, upsert: false });
  if (error) throw error;
  return path;
}
