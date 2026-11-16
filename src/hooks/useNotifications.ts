import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { countUnread, listInbox, markNotificationsRead } from '@/api/notifications';
import { queryKeys } from '@/lib/queryClient';
import { useAuth } from '@/providers/AuthProvider';

/** The signed-in person's inbox, newest first (PRD-2.0 R1.5). */
export function useInbox() {
  const { user } = useAuth();
  return useQuery({
    queryKey: queryKeys.inbox(user?.id),
    queryFn: listInbox,
    enabled: !!user,
  });
}

/**
 * Unread entries, for the badge. Refreshed on a push (root layout), on focus,
 * and every minute while the app is open, so an alert whose push was denied
 * or silenced by quiet hours still shows up.
 */
export function useUnreadCount() {
  const { user } = useAuth();
  return useQuery({
    queryKey: queryKeys.unreadCount(user?.id),
    queryFn: countUnread,
    enabled: !!user,
    refetchInterval: 60_000,
  });
}

export function useMarkRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids?: string[]) => markNotificationsRead(ids),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });
}
