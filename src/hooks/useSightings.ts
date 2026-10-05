import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  addPhoto,
  claimSighting,
  createSighting,
  getFeed,
  getMyRescues,
  getMySightings,
  getMyActivity,
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
import { useScreenActive } from '@/hooks/useScreenActive';
import { track } from '@/lib/observability';
import { queryKeys } from '@/lib/queryClient';
import { useAuth } from '@/providers/AuthProvider';
import type { CatStatus, CatTemperament, Sighting } from '@/types/models';

/** How often an open report re-checks for a claim, status change or new comment. */
const DETAIL_REFRESH_MS = 20_000;

const sameFilter = (a?: CatStatus[], b?: CatStatus[]) => (a ?? []).join() === (b ?? []).join();

export function useNearbySightings(params: NearbyParams | null) {
  const active = useScreenActive();
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
    // Every pan or zoom is a new query key. Keep showing the previous pins and
    // list until the new area answers, instead of blanking the map on each
    // gesture — but not across a filter change, where stale rows would be wrong.
    placeholderData: (previous, previousQuery) => {
      const previousParams = previousQuery?.queryKey[2] as NearbyParams | undefined;
      return previousParams && sameFilter(previousParams.statuses, params?.statuses)
        ? previous
        : undefined;
    },
    // Refresh through the privacy-preserving RPC, never raw location events.
    refetchInterval: active ? 30_000 : false,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });
}

export function useFeed(statuses?: CatStatus[], temperament?: CatTemperament) {
  return useInfiniteQuery({
    queryKey: queryKeys.feed({ statuses, temperament }),
    queryFn: ({ pageParam }) => getFeed(statuses, pageParam, 20, temperament),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

export function useMyActivity() {
  const { user } = useAuth();
  return useQuery({
    queryKey: queryKeys.myActivity(user?.id),
    queryFn: () => getMyActivity(user!.id),
    enabled: !!user,
  });
}

export function useSighting(id?: string) {
  const active = useScreenActive();
  return useQuery({
    queryKey: queryKeys.sighting(id ?? ''),
    queryFn: () => getSighting(id as string),
    enabled: !!id,
    // A reporter waiting on a Guardian, or a Guardian racing another one, needs
    // the screen to catch up without a manual pull.
    refetchInterval: active ? DETAIL_REFRESH_MS : false,
    refetchIntervalInBackground: false,
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

/** The cats this user is assigned to as a Guardian (see getMyRescues). */
export function useMyRescues() {
  const { user } = useAuth();
  return useQuery({
    queryKey: queryKeys.myRescues(user?.id),
    queryFn: () => getMyRescues(user!.id),
    enabled: !!user,
  });
}

export function useSightingUpdates(id?: string) {
  const active = useScreenActive();
  return useQuery({
    queryKey: queryKeys.sightingUpdates(id ?? ''),
    queryFn: () => getUpdates(id as string),
    enabled: !!id,
    // Activity is the coordination channel between reporter and Guardian.
    refetchInterval: active ? DETAIL_REFRESH_MS : false,
    refetchIntervalInBackground: false,
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

/**
 * Re-read a sighting after a mutation FAILED. A rejected claim or transition
 * means the screen's picture of the cat was already wrong (someone else claimed
 * it, the status moved on), so leaving the cache alone would keep offering the
 * same doomed action.
 */
function useRefreshSighting() {
  const qc = useQueryClient();
  return (id: string) => {
    qc.invalidateQueries({ queryKey: ['sightings'] });
    qc.invalidateQueries({ queryKey: queryKeys.sighting(id) });
    qc.invalidateQueries({ queryKey: queryKeys.sightingUpdates(id) });
  };
}

export interface CreatedSighting {
  sighting: Sighting;
  /** Photos that were uploaded but could not be attached to the new report. */
  failedPhotoUrls: string[];
}

export function useCreateSighting() {
  const invalidate = useInvalidateSightings();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (
      input: CreateSightingInput & { photoUrls?: string[] },
    ): Promise<CreatedSighting> => {
      // Once this resolves the report exists and an urgent one has already
      // alerted Guardians (DB trigger). It must never be deleted afterwards: a
      // failed photo attach used to roll the report back, leaving a duplicate
      // alert behind whenever the delete itself failed.
      const sighting = await createSighting(input);
      const photoUrls = input.photoUrls ?? [];
      if (!photoUrls.length || !user) return { sighting, failedPhotoUrls: [] };

      const attach = (urls: string[]) =>
        Promise.allSettled(urls.map((url) => addPhoto(sighting.id, url, user.id)));
      const first = await attach(photoUrls);
      let failed = photoUrls.filter((_, i) => first[i].status === 'rejected');
      if (failed.length) {
        // One retry rides out a transient network error.
        const retry = await attach(failed);
        failed = failed.filter((_, i) => retry[i].status === 'rejected');
      }
      return { sighting, failedPhotoUrls: failed };
    },
    onSuccess: ({ sighting }) => {
      invalidate(sighting.id);
      track('report_created', { id: sighting.id, urgent: sighting.needs_urgent_help });
      // Urgent reports ping nearby guardians via a DB trigger (migration 0029)
      // → send-push, so the alert still goes out if the app dies right after.
    },
  });
}

export function useClaimSighting() {
  const invalidate = useInvalidateSightings();
  const refresh = useRefreshSighting();
  return useMutation({
    mutationFn: (id: string) => claimSighting(id),
    // Key off the id that was asked about, not the returned row: the row is
    // only a convenience and the refresh must happen whatever it contains.
    onSuccess: (_s, id) => {
      invalidate(id);
      track('sighting_claimed', { id });
    },
    onError: (_error, id) => refresh(id),
  });
}

export function useUpdateStatus() {
  const invalidate = useInvalidateSightings();
  const refresh = useRefreshSighting();
  return useMutation({
    mutationFn: (vars: { id: string; status: CatStatus; note?: string }) =>
      updateStatus(vars.id, vars.status, vars.note),
    onSuccess: (_s, vars) => {
      invalidate(vars.id);
      if (vars.status === 'safe') track('rescue_completed', { id: vars.id });
      if (vars.status === 'spotted') track('claim_released', { id: vars.id });
    },
    onError: (_error, vars) => refresh(vars.id),
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
