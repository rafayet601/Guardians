import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { AppState } from 'react-native';

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
  updateSightingDescription,
  updateStatus,
  type CreateSightingInput,
  type NearbyParams,
} from '@/api/sightings';
import { screenCommentBestEffort } from '@/hooks/useAiModeration';
import { track } from '@/lib/observability';
import { queryKeys } from '@/lib/queryClient';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/providers/AuthProvider';
import type { CatStatus } from '@/types/models';

export function useNearbySightings(params: NearbyParams | null) {
  const [active, setActive] = useState(false);
  useFocusEffect(
    useCallback(() => {
      setActive(AppState.currentState === 'active');
      const subscription = AppState.addEventListener('change', (state) => {
        setActive(state === 'active');
      });
      return () => {
        subscription.remove();
        setActive(false);
      };
    }, []),
  );
  // nearby_sightings is granted to `authenticated` only (0016/0027). The map
  // tab mounts before the root layout redirects a logged-out user to /welcome,
  // so without this gate every cold start fires the RPC as anon, gets 42501,
  // and reports a false error to Sentry.
  const { session } = useAuth();
  return useQuery({
    queryKey: queryKeys.nearby(params ?? {}),
    queryFn: () => getNearby(params as NearbyParams),
    enabled: !!params && !!session && active,
    staleTime: 15_000,
    // Refresh through the privacy-preserving RPC, never raw location events.
    refetchInterval: active ? 30_000 : false,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
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
      try {
        if (input.photoUrls?.length && user) {
          await Promise.all(input.photoUrls.map((url) => addPhoto(sighting.id, url, user.id)));
        }
        return sighting;
      } catch (err) {
        try {
          await supabase.from('sightings').delete().eq('id', sighting.id);
        } catch (rollbackErr) {
          console.error('Failed to rollback sighting after photo error:', rollbackErr);
        }
        throw err;
      }
    },
    onSuccess: (s) => {
      invalidate(s.id);
      track('report_created', { id: s.id, urgent: s.needs_urgent_help });
      // Urgent reports ping nearby guardians via a DB trigger (migration 0029)
      // → send-push, so the alert still goes out if the app dies right after.
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

/**
 * Save an (edited) listing description — used to persist the reviewed AI
 * adoption-listing draft via the existing update path. Invalidates the sighting
 * so the detail view reflects the new copy.
 */
export function useUpdateDescription() {
  const invalidate = useInvalidateSightings();
  return useMutation({
    mutationFn: (vars: { id: string; description: string }) =>
      updateSightingDescription(vars.id, vars.description),
    onSuccess: (s) => invalidate(s.id),
  });
}

export function usePostComment(sightingId: string) {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: (body: string) => postComment(sightingId, user!.id, body),
    onSuccess: (comment) => {
      qc.invalidateQueries({ queryKey: queryKeys.sightingUpdates(sightingId) });
      // 🛡️ Background text screening (AI-M2 #10). Fire-and-forget by contract:
      // the helper no-ops when its flag is off and swallows its own errors, so
      // a moderation hiccup can never block or fail the posted comment.
      void screenCommentBestEffort(comment.id, comment.body ?? '');
    },
  });
}
