import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { approveAdoption, expressInterest, getAdoptionInterest } from '@/api/sightings';
import { queryKeys } from '@/lib/queryClient';

export function useAdoptionInterest(sightingId: string) {
  return useQuery({
    queryKey: queryKeys.adoptionInterest(sightingId),
    queryFn: () => getAdoptionInterest(sightingId),
    enabled: !!sightingId,
  });
}

export function useExpressInterest(sightingId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (message?: string) => expressInterest(sightingId, message),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: queryKeys.adoptionInterest(sightingId) }),
  });
}

export function useApproveAdoption(sightingId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (interestId: string) => approveAdoption(interestId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.adoptionInterest(sightingId) });
      qc.invalidateQueries({ queryKey: queryKeys.sighting(sightingId) });
      qc.invalidateQueries({ queryKey: ['sightings'] });
      // approving awards points + the matchmaker badge to the lister
      qc.invalidateQueries({ queryKey: queryKeys.me });
      qc.invalidateQueries({ queryKey: queryKeys.leaderboard });
      qc.invalidateQueries({ queryKey: ['badges'] });
    },
  });
}
