import { useQuery } from '@tanstack/react-query';

import { getAllBadges, getLeaderboard, getMyRank, getUserBadges } from '@/api/gamification';
import { queryKeys } from '@/lib/queryClient';

export function useLeaderboard() {
  return useQuery({
    queryKey: queryKeys.leaderboard,
    queryFn: () => getLeaderboard(50),
    staleTime: 60_000,
  });
}

/**
 * The signed-in user's rank. Pass `undefined` to skip the query (e.g. when they
 * are already visible in the top-N list). The key sits under `leaderboard` so
 * the existing invalidation after points change refreshes it too.
 */
export function useMyRank(points?: number) {
  return useQuery({
    queryKey: [...queryKeys.leaderboard, 'rank', points] as const,
    queryFn: () => getMyRank(points as number),
    enabled: points != null,
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
