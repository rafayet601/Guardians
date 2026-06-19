import { useQuery } from '@tanstack/react-query';

import { getAllBadges, getLeaderboard, getUserBadges } from '@/api/gamification';
import { queryKeys } from '@/lib/queryClient';

export function useLeaderboard() {
  return useQuery({
    queryKey: queryKeys.leaderboard,
    queryFn: () => getLeaderboard(50),
    staleTime: 60_000,
  });
}

export function useAllBadges() {
  return useQuery({
    queryKey: queryKeys.badges('all'),
    queryFn: getAllBadges,
    staleTime: 60 * 60_000,
  });
}

export function useUserBadges(userId?: string) {
  return useQuery({
    queryKey: queryKeys.badges(userId),
    queryFn: () => getUserBadges(userId as string),
    enabled: !!userId,
  });
}
