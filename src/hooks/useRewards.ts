import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  getMyRedemptions,
  getOffers,
  getPlacements,
  getWallet,
  redeemReward,
} from '@/api/rewards';
import { track } from '@/lib/observability';
import { queryKeys } from '@/lib/queryClient';
import { useAuth } from '@/providers/AuthProvider';
import type { PlacementSlot } from '@/types/models';

export function useOffers() {
  return useQuery({
    queryKey: queryKeys.offers,
    queryFn: getOffers,
    staleTime: 60_000,
  });
}

export function useMyRedemptions() {
  const { user } = useAuth();
  return useQuery({
    queryKey: queryKeys.myRedemptions(user?.id),
    queryFn: () => getMyRedemptions(user!.id),
    enabled: !!user,
  });
}

export function useWallet() {
  const { user } = useAuth();
  return useQuery({
    queryKey: queryKeys.wallet(user?.id),
    queryFn: () => getWallet(user!.id),
    enabled: !!user,
  });
}

export function usePlacements(slot: PlacementSlot) {
  return useQuery({
    queryKey: queryKeys.placements(slot),
    queryFn: () => getPlacements(slot),
    staleTime: 5 * 60_000,
  });
}

export function useRedeemReward() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (offerId: string) => redeemReward(offerId),
    onSuccess: (redemption) => {
      track('reward_redeemed', { offer_id: redemption.offer_id, cost: redemption.cost_kibble });
      // Kibble balance lives on the profile; offers/redemptions/wallet all change.
      qc.invalidateQueries({ queryKey: queryKeys.me });
      qc.invalidateQueries({ queryKey: ['profile'] });
      qc.invalidateQueries({ queryKey: ['rewards'] });
    },
  });
}
