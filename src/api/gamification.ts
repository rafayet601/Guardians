import { supabase } from '@/lib/supabase';
import type { Badge, LeaderboardEntry, UserBadge } from '@/types/models';

export async function getLeaderboard(limit = 50): Promise<LeaderboardEntry[]> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, username, avatar_url, points, level, rescues_count')
    .order('points', { ascending: false })
    .order('rescues_count', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []).map((row, i) => ({ ...row, rank: i + 1 }) as LeaderboardEntry);
}

export async function getAllBadges(): Promise<Badge[]> {
  const { data, error } = await supabase
    .from('badges')
    .select('*')
    .order('sort_order', { ascending: true });
  if (error) throw error;
  return (data ?? []) as Badge[];
}

export async function getUserBadges(userId: string): Promise<UserBadge[]> {
  const { data, error } = await supabase
    .from('user_badges')
    .select('user_id, badge_id, awarded_at, badge:badges(*)')
    .eq('user_id', userId)
    .order('awarded_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as UserBadge[];
}
