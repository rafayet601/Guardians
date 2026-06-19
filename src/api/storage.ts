import { Buffer } from 'buffer';

import { supabase } from '@/lib/supabase';

export type Bucket = 'cat-photos' | 'avatars';

export interface LocalAsset {
  uri: string;
  mimeType?: string | null;
  fileName?: string | null;
  /** base64 of the image (request it from expo-image-picker with base64: true). */
  base64?: string | null;
}

function extFromAsset(asset: LocalAsset): string {
  const mime = asset.mimeType ?? '';
  if (mime.includes('png')) return 'png';
  if (mime.includes('webp')) return 'webp';
  if (mime.includes('heic')) return 'heic';
  const m = asset.uri.match(/\.(\w+)(?:\?|$)/);
  return m ? m[1].toLowerCase() : 'jpg';
}

/**
 * Uploads a local image (from expo-image-picker) into a per-user folder and
 * returns its public URL. The path "{uid}/..." satisfies the storage RLS policy.
 *
 * We decode the picker's base64 rather than `fetch(uri).arrayBuffer()`, which is
 * unreliable for local file URIs on Hermes (it can yield 0-byte/corrupt files).
 * Pass the asset with `base64` populated (expo-image-picker `base64: true`).
 */
export async function uploadImage(
  bucket: Bucket,
  userId: string,
  asset: LocalAsset,
): Promise<string> {
  if (!asset.base64) {
    throw new Error('Image is missing data — please pick the photo again.');
  }
  const bytes = Buffer.from(asset.base64, 'base64');
  const ext = extFromAsset(asset);
  const contentType = asset.mimeType ?? `image/${ext === 'jpg' ? 'jpeg' : ext}`;
  const path = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

  const { error } = await supabase.storage
    .from(bucket)
    .upload(path, bytes, { contentType, upsert: false });
  if (error) throw error;

  return supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl;
}

export const uploadCatPhoto = (userId: string, asset: LocalAsset) =>
  uploadImage('cat-photos', userId, asset);

export const uploadAvatar = (userId: string, asset: LocalAsset) =>
  uploadImage('avatars', userId, asset);
