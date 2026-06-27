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
  const { error } = await supabase.rpc('moderate_content', { p_type: type, p_id: id, p_hide: hide });
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
