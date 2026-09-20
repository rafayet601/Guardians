import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
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

/** Normalize to compressed JPEG and bound dimensions before transmitting. */
export async function uploadImage(
  bucket: Bucket,
  userId: string,
  asset: LocalAsset,
): Promise<string> {
  const context = ImageManipulator.manipulate(asset.uri);
  const original = await context.renderAsync();
  const maxSide = bucket === 'avatars' ? 512 : 1600;
  const scale = Math.min(1, maxSide / Math.max(original.width, original.height));
  const resized = ImageManipulator.manipulate(original);
  let image = original;
  try {
    if (scale < 1) {
      resized.resize({
        width: Math.round(original.width * scale),
        height: Math.round(original.height * scale),
      });
      image = await resized.renderAsync();
    }
    const result = await image.saveAsync({ format: SaveFormat.JPEG, compress: 0.75, base64: true });
    if (!result.base64) throw new Error('Unable to prepare photo. Please choose it again.');
    const bytes = Buffer.from(result.base64, 'base64');
    if (!bytes.length || bytes.length > 5 * 1024 * 1024)
      throw new Error('Please choose a smaller photo.');
    const path = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
    const { error } = await supabase.storage
      .from(bucket)
      .upload(path, bytes, { contentType: 'image/jpeg', upsert: false });
    if (error) throw error;

    return supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl;
  } finally {
    if (image !== original) image.release();
    resized.release();
    original.release();
    context.release();
  }
}

export const uploadCatPhoto = (userId: string, asset: LocalAsset) =>
  uploadImage('cat-photos', userId, asset);

export const uploadAvatar = (userId: string, asset: LocalAsset) =>
  uploadImage('avatars', userId, asset);
