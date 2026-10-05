import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { getMyProfile, getProfile, updateMyProfile, type ProfilePatch } from '@/api/profiles';
import { captureAccountCacheGuard } from '@/lib/accountCache';
import { queryKeys } from '@/lib/queryClient';
import { useAuth } from '@/providers/AuthProvider';

export function useMyProfile() {
  const { user } = useAuth();
  return useQuery({
    queryKey: queryKeys.me,
    queryFn: getMyProfile,
    enabled: !!user,
  });
}

export function useProfile(id?: string) {
  return useQuery({
    queryKey: queryKeys.profile(id),
    queryFn: () => getProfile(id as string),
    enabled: !!id,
  });
}

export function useUpdateProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: ProfilePatch) => updateMyProfile(patch),
    onMutate: () => captureAccountCacheGuard(qc),
    onSuccess: (profile, _patch, isCurrentAccount) => {
      if (!isCurrentAccount?.()) return;
      qc.setQueryData(queryKeys.me, profile);
      qc.invalidateQueries({ queryKey: queryKeys.profile(profile.id) });
      // username/avatar are embedded in these views — keep them fresh
      qc.invalidateQueries({ queryKey: queryKeys.leaderboard });
      qc.invalidateQueries({ queryKey: ['sightings'] });
    },
  });
}
