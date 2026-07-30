import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  blockUser,
  checkIsModerator,
  getBlockedUsers,
  getModerationQueue,
  moderateContent,
  reportContent,
  unblockUser,
} from '@/api/moderation';
import { queryKeys } from '@/lib/queryClient';
import { useAuth } from '@/providers/AuthProvider';
import type { ModerationTarget } from '@/types/models';

/** Local key (queryKeys in lib/queryClient is shared; prefix-invalidation still matches). */
const blockedUsersKey = (id?: string) => ['moderation', 'blocked-users', id] as const;

export function useIsModerator() {
  const { user } = useAuth();
  return useQuery({
    queryKey: queryKeys.isModerator(user?.id),
    queryFn: checkIsModerator,
    enabled: !!user,
    staleTime: 5 * 60_000,
  });
}

export function useReportContent() {
  return useMutation({
    mutationFn: (vars: { type: ModerationTarget; id: string; reason?: string }) =>
      reportContent(vars.type, vars.id, vars.reason),
  });
}

export function useBlockUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (blockedId: string) => blockUser(blockedId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sighting'] });
      qc.invalidateQueries({ queryKey: ['moderation', 'blocked-users'] });
    },
  });
}

export function useBlockedUsers() {
  const { user } = useAuth();
  return useQuery({
    queryKey: blockedUsersKey(user?.id),
    queryFn: getBlockedUsers,
    enabled: !!user,
  });
}

export function useUnblockUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (blockedId: string) => unblockUser(blockedId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['moderation', 'blocked-users'] });
      qc.invalidateQueries({ queryKey: ['sighting'] });
    },
  });
}

export function useModerationQueue() {
  const { data: isModerator } = useIsModerator();
  return useQuery({
    queryKey: queryKeys.moderationQueue,
    queryFn: getModerationQueue,
    enabled: !!isModerator,
  });
}

export function useModerateContent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { type: ModerationTarget; id: string; hide: boolean }) =>
      moderateContent(vars.type, vars.id, vars.hide),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.moderationQueue });
      qc.invalidateQueries({ queryKey: ['sighting'] });
      qc.invalidateQueries({ queryKey: ['sightings'] });
    },
  });
}
