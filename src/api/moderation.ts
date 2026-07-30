import { supabase } from '@/lib/supabase';
import type { ModerationTarget } from '@/types/models';

/** True if the current user is a moderator/admin. Resilient: returns false if
 *  the is_moderator() RPC isn't deployed yet (migration 0012). */
export async function checkIsModerator(): Promise<boolean> {
  const { data, error } = await supabase.rpc('is_moderator');
  if (error) return false;
  return data === true;
}

export async function reportContent(
  type: ModerationTarget,
  id: string,
  reason?: string,
): Promise<void> {
  const { error } = await supabase.rpc('report_content', {
    p_type: type,
    p_id: id,
    p_reason: reason,
  });
  if (error) throw error;
}

/** Moderator-only takedown / restore. */
export async function moderateContent(
  type: ModerationTarget,
  id: string,
  hide: boolean,
): Promise<void> {
  const { error } = await supabase.rpc('moderate_content', {
    p_type: type,
    p_id: id,
    p_hide: hide,
  });
  if (error) throw error;
}

export async function blockUser(blockedId: string): Promise<void> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new Error('Not authenticated');
  const { error } = await supabase
    .from('user_blocks')
    .insert({ blocker_id: auth.user.id, blocked_id: blockedId });
  if (error) throw error;
}

export async function unblockUser(blockedId: string): Promise<void> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new Error('Not authenticated');
  const { error } = await supabase
    .from('user_blocks')
    .delete()
    .eq('blocker_id', auth.user.id)
    .eq('blocked_id', blockedId);
  if (error) throw error;
}

export interface BlockedUser {
  /** The blocked profile's id. */
  blocked_id: string;
  /** When the block was created (ISO timestamp). */
  blocked_at: string;
  username: string;
  full_name: string | null;
  avatar_url: string | null;
}

/** The caller's blocked users, newest first, joined to the blocked profile. */
export async function getBlockedUsers(): Promise<BlockedUser[]> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new Error('Not authenticated');
  const { data, error } = await supabase
    .from('user_blocks')
    .select(
      'blocked_id, created_at, blocked:profiles!user_blocks_blocked_id_fkey(id, username, full_name, avatar_url)',
    )
    .eq('blocker_id', auth.user.id)
    .order('created_at', { ascending: false });
  if (error) throw error;

  // user_blocks IS in the generated Database types, but the embedded profiles
  // resource can't be statically resolved — same boundary cast sightings.ts
  // uses for its embedded selects.
  const rows = (data ?? []) as unknown as {
    blocked_id: string;
    created_at: string;
    blocked: {
      id: string;
      username: string;
      full_name: string | null;
      avatar_url: string | null;
    } | null;
  }[];
  return rows.map((r) => ({
    blocked_id: r.blocked_id,
    blocked_at: r.created_at,
    username: r.blocked?.username ?? 'Unknown user',
    full_name: r.blocked?.full_name ?? null,
    avatar_url: r.blocked?.avatar_url ?? null,
  }));
}

export interface ModerationQueueItem {
  target_type: ModerationTarget;
  target_id: string;
  report_count: number;
  latest_reason: string | null;
  latest_at: string;
}

/** Open reports grouped by target, most-reported first (moderators only). */
export async function getModerationQueue(): Promise<ModerationQueueItem[]> {
  const { data, error } = await supabase
    .from('abuse_reports')
    .select('target_type, target_id, reason, created_at')
    .eq('status', 'open')
    .order('created_at', { ascending: false });
  if (error) throw error;

  const grouped = new Map<string, ModerationQueueItem>();
  for (const r of (data ?? []) as {
    target_type: ModerationTarget;
    target_id: string;
    reason: string | null;
    created_at: string;
  }[]) {
    const key = `${r.target_type}:${r.target_id}`;
    const existing = grouped.get(key);
    if (existing) {
      existing.report_count += 1;
    } else {
      grouped.set(key, {
        target_type: r.target_type,
        target_id: r.target_id,
        report_count: 1,
        latest_reason: r.reason,
        latest_at: r.created_at,
      });
    }
  }
  return [...grouped.values()].sort((a, b) => b.report_count - a.report_count);
}
