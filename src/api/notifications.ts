import { supabase } from '@/lib/supabase';
import type { CatStatus } from '@/types/models';

/**
 * Everything the server can put in a person's inbox (0043). Mirrors the
 * `notifications_kind` check constraint.
 */
export type NotificationKind =
  | 'urgent_sighting'
  | 'sighting_claimed'
  | 'rescue_completed'
  | 'adoption_interest'
  | 'case_status'
  | 'screening_decided'
  | 'adoption_approved'
  | 'adoption_declined'
  | 'new_comment'
  | 'ops_job_failed'
  | 'claim_expiring'
  | 'claim_expired'
  | 'claim_reopened'
  | 'urgent_unclaimed'
  | 'urgent_no_responder';

export interface InboxItem {
  id: string;
  kind: NotificationKind;
  sighting_id: string | null;
  /** step (urgent alerts), status (case_status, screening_decided). */
  detail: { step?: number; status?: string };
  /** Arrived in quiet hours, so it was not pushed. */
  silent: boolean;
  created_at: string;
  read_at: string | null;
  /** Null when the report is gone or hidden from this person. */
  sighting: { id: string; title: string | null; status: CatStatus } | null;
}

const INBOX_PAGE = 50;

/** The signed-in person's newest entries. RLS limits rows to their own. */
export async function listInbox(): Promise<InboxItem[]> {
  const { data, error } = await supabase
    .from('notifications')
    .select(
      'id, kind, sighting_id, detail, silent, created_at, read_at, sighting:sightings(id, title, status)',
    )
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(INBOX_PAGE);
  if (error) throw error;
  return (data ?? []) as unknown as InboxItem[];
}

export async function countUnread(): Promise<number> {
  const { count, error } = await supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .is('read_at', null);
  if (error) throw error;
  return count ?? 0;
}

/** Mark the given entries read, or every unread entry when no ids are given. */
export async function markNotificationsRead(ids?: string[]): Promise<number> {
  const { data, error } = await supabase.rpc('mark_notifications_read', ids ? { p_ids: ids } : {});
  if (error) throw error;
  return data ?? 0;
}
