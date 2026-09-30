import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  getMyScreening,
  getScreeningDocUrls,
  getScreeningQueue,
  ID_PHOTO_URL_TTL_S,
  isAdopterCleared,
  reviewScreening,
  startIdVerification,
  submitScreening,
  type ScreeningDecision,
} from '@/api/screening';
import { useIsModerator } from '@/hooks/useModeration';
import { track } from '@/lib/observability';
import { queryKeys } from '@/lib/queryClient';
import { useAuth } from '@/providers/AuthProvider';

export function useMyScreening() {
  const { user } = useAuth();
  return useQuery({
    queryKey: queryKeys.screening,
    queryFn: getMyScreening,
    enabled: !!user,
    staleTime: 60_000,
  });
}

/** Lister-side boolean per applicant (no PII). */
export function useApplicantCleared(userId?: string) {
  return useQuery({
    queryKey: queryKeys.screeningCleared(userId ?? ''),
    queryFn: () => isAdopterCleared(userId!),
    enabled: !!userId,
    staleTime: 60_000,
  });
}

export function useSubmitScreening() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: submitScreening,
    onSuccess: (screening) => {
      qc.setQueryData(queryKeys.screening, screening);
      qc.invalidateQueries({ queryKey: queryKeys.screening });
      track('screening_submitted', { status: screening.status });
    },
  });
}

export function useStartIdVerification() {
  return useMutation({
    mutationFn: (docPaths: string[]) => startIdVerification(docPaths),
    onSuccess: (res) => {
      track('screening_verification_started', { provider: res.provider });
    },
  });
}

// ── Moderator review (migration 0038) ────────────────────────────────────────

export function useScreeningQueue() {
  const { data: isModerator } = useIsModerator();
  return useQuery({
    queryKey: queryKeys.screeningQueue,
    queryFn: getScreeningQueue,
    enabled: !!isModerator,
  });
}

/** Signed links to one applicant's ID photos, refreshed before they expire. */
export function useScreeningDocUrls(userId: string, paths: readonly string[]) {
  return useQuery({
    queryKey: queryKeys.screeningDocs(userId, paths),
    queryFn: () => getScreeningDocUrls([...paths]),
    enabled: paths.length > 0,
    staleTime: (ID_PHOTO_URL_TTL_S - 60) * 1000,
    gcTime: 0,
  });
}

export function useReviewScreening() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { userId: string; decision: ScreeningDecision; reason?: string }) =>
      reviewScreening(vars.userId, vars.decision, vars.reason),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: queryKeys.screeningQueue });
      qc.invalidateQueries({ queryKey: queryKeys.screeningCleared(vars.userId) });
      track('screening_reviewed', { decision: vars.decision });
    },
  });
}
