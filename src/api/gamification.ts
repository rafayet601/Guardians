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

/**
 * Where a user with `points` stands: one more than the number of people with
 * strictly more points (ties share a rank). The top-50 list can't say this for
 * anyone below it, which is most people.
 */
export async function getMyRank(points: number): Promise<number> {
  const { count, error } = await supabase
    .from('profiles')
    .select('id', { count: 'exact', head: true })
    .gt('points', points);
  if (error) throw error;
  return (count ?? 0) + 1;
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
