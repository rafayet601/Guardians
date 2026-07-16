import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';

import { captureError } from '@/lib/observability';

export const queryClient = new QueryClient({
  // Surface every query/mutation failure through the observability façade.
  queryCache: new QueryCache({
    onError: (error) => captureError(error, { source: 'query' }),
  }),
  mutationCache: new MutationCache({
    onError: (error) => captureError(error, { source: 'mutation' }),
  }),
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      retry: 2,
      refetchOnWindowFocus: false,
    },
    mutations: {
      retry: 0,
    },
  },
});

/** Centralized query keys so invalidation stays consistent across the app. */
export const queryKeys = {
  profile: (id?: string) => ['profile', id] as const,
  me: ['me'] as const,
  nearby: (params: object) => ['sightings', 'nearby', params] as const,
  sighting: (id: string) => ['sighting', id] as const,
  sightingUpdates: (id: string) => ['sighting', id, 'updates'] as const,
  sightingPhotos: (id: string) => ['sighting', id, 'photos'] as const,
  mySightings: (id?: string) => ['sightings', 'mine', id] as const,
  feed: (params: object) => ['sightings', 'feed', params] as const,
  leaderboard: ['leaderboard'] as const,
  badges: (id?: string) => ['badges', id] as const,
  adoptionInterest: (sightingId: string) => ['adoption-interest', sightingId] as const,
  offers: ['rewards', 'offers'] as const,
  myRedemptions: (id?: string) => ['rewards', 'redemptions', id] as const,
  wallet: (id?: string) => ['rewards', 'wallet', id] as const,
  placements: (slot: string) => ['rewards', 'placements', slot] as const,
  isModerator: (id?: string) => ['moderator', id] as const,
  moderationQueue: ['moderation', 'queue'] as const,
  lostCats: ['lost-cats'] as const,
  lostCat: (id: string) => ['lost-cat', id] as const,
  lostCatMatches: (id: string) => ['lost-cat-matches', id] as const,
  reidCandidates: (id: string) => ['reid-candidates', id] as const,
  journeyTimeline: (id: string) => ['journey-timeline', id] as const,
};
