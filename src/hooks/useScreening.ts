import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  getMyScreening,
  isAdopterCleared,
  startIdVerification,
  submitScreening,
} from '@/api/screening';
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
