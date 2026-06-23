import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  addPhoto,
  claimSighting,
  createSighting,
  getFeed,
  getMySightings,
  getNearby,
  getSighting,
  getUpdates,
  postComment,
  updateStatus,
  type CreateSightingInput,
  type NearbyParams,
} from '@/api/sightings';
import { notifyUrgentSighting } from '@/api/push';
import { track } from '@/lib/observability';
import { queryKeys } from '@/lib/queryClient';
import { useAuth } from '@/providers/AuthProvider';
import type { CatStatus } from '@/types/models';

export function useNearbySightings(params: NearbyParams | null) {
  return useQuery({
    queryKey: queryKeys.nearby(params ?? {}),
    queryFn: () => getNearby(params as NearbyParams),
    enabled: !!params,
    staleTime: 15_000,
  });
}

export function useFeed(statuses?: CatStatus[]) {
  return useInfiniteQuery({
    queryKey: queryKeys.feed({ statuses }),
    queryFn: ({ pageParam }) => getFeed(statuses, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

export function useSighting(id?: string) {
  return useQuery({
    queryKey: queryKeys.sighting(id ?? ''),
    queryFn: () => getSighting(id as string),
    enabled: !!id,
  });
}

export function useMySightings() {
  const { user } = useAuth();
  return useQuery({
    queryKey: queryKeys.mySightings(user?.id),
    queryFn: () => getMySightings(user!.id),
    enabled: !!user,
  });
}

export function useSightingUpdates(id?: string) {
  return useQuery({
    queryKey: queryKeys.sightingUpdates(id ?? ''),
    queryFn: () => getUpdates(id as string),
    enabled: !!id,
  });
}

/** Invalidate everything that a changed sighting (and its points) could appear in. */
function useInvalidateSightings() {
  const qc = useQueryClient();
  return (id?: string) => {
    qc.invalidateQueries({ queryKey: ['sightings'] });
    qc.invalidateQueries({ queryKey: queryKeys.me });
    // points/badges can change on claim, rescue, and report → refresh derived views
    qc.invalidateQueries({ queryKey: queryKeys.leaderboard });
    qc.invalidateQueries({ queryKey: ['badges'] });
    if (id) {
      qc.invalidateQueries({ queryKey: queryKeys.sighting(id) });
      qc.invalidateQueries({ queryKey: queryKeys.sightingUpdates(id) });
    }
  };
}

export function useCreateSighting() {
  const invalidate = useInvalidateSightings();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (input: CreateSightingInput & { photoUrls?: string[] }) => {
      const sighting = await createSighting(input);
      if (input.photoUrls?.length && user) {
        await Promise.all(input.photoUrls.map((url) => addPhoto(sighting.id, url, user.id)));
      }
      return sighting;
    },
    onSuccess: (s) => {
      invalidate(s.id);
      track('report_created', { id: s.id, urgent: s.needs_urgent_help });
      // Urgent reports ping nearby guardians via the send-push Edge Function.
      if (s.needs_urgent_help) void notifyUrgentSighting(s.id);
    },
  });
}

export function useClaimSighting() {
  const invalidate = useInvalidateSightings();
  return useMutation({
    mutationFn: (id: string) => claimSighting(id),
    onSuccess: (s) => {
      invalidate(s.id);
      track('sighting_claimed', { id: s.id });
    },
  });
}

export function useUpdateStatus() {
  const invalidate = useInvalidateSightings();
  return useMutation({
    mutationFn: (vars: { id: string; status: CatStatus; note?: string }) =>
      updateStatus(vars.id, vars.status, vars.note),
    onSuccess: (s) => {
      invalidate(s.id);
      if (s.status === 'safe') track('rescue_completed', { id: s.id });
    },
  });
}

export function usePostComment(sightingId: string) {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: (body: string) => postComment(sightingId, user!.id, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.sightingUpdates(sightingId) }),
  });
}
