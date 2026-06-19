import { supabase } from '@/lib/supabase';
import type { Profile } from '@/types/models';

const PROFILE_COLUMNS =
  'id, username, full_name, avatar_url, bio, is_guardian, wants_to_adopt, points, kibble_balance, level, reports_count, rescues_count, adoptions_count, created_at, updated_at';

export async function getMyProfile(): Promise<Profile | null> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return null;
  const { data, error } = await supabase
    .from('profiles')
    .select(PROFILE_COLUMNS)
    .eq('id', auth.user.id)
    .single();
  if (error) throw error;
  return data as Profile;
}

export async function getProfile(id: string): Promise<Profile> {
  const { data, error } = await supabase
    .from('profiles')
    .select(PROFILE_COLUMNS)
    .eq('id', id)
    .single();
  if (error) throw error;
  return data as Profile;
}

export type ProfilePatch = Partial<
  Pick<Profile, 'username' | 'full_name' | 'avatar_url' | 'bio' | 'is_guardian' | 'wants_to_adopt'>
>;

export async function updateMyProfile(patch: ProfilePatch): Promise<Profile> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new Error('Not authenticated');
  const { data, error } = await supabase
    .from('profiles')
    .update(patch)
    .eq('id', auth.user.id)
    .select(PROFILE_COLUMNS)
    .single();
  if (error) throw error;
  return data as Profile;
}

export async function savePushToken(token: string): Promise<void> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return;
  // Stored in a dedicated owner-only table so a push token never leaks via a
  // public profile read.
  await supabase
    .from('device_push_tokens')
    .upsert({ user_id: auth.user.id, token, updated_at: new Date().toISOString() });
}
