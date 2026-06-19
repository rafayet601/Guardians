import { supabase } from '@/lib/supabase';
import type {
  PlacementSlot,
  Profile,
  RewardOffer,
  RewardRedemption,
  SponsoredPlacement,
  WalletTransaction,
} from '@/types/models';

const OFFER_SELECT = `
  *,
  brand:reward_brands!reward_offers_brand_id_fkey(*)
`;

/** Active offers, cheapest first, with their brand joined. */
export async function getOffers(): Promise<RewardOffer[]> {
  const { data, error } = await supabase
    .from('reward_offers')
    .select(OFFER_SELECT)
    .eq('is_active', true)
    .order('cost_kibble', { ascending: true });
  if (error) throw error;
  return (data ?? []) as unknown as RewardOffer[];
}

export async function getMyRedemptions(userId: string): Promise<RewardRedemption[]> {
  const { data, error } = await supabase
    .from('reward_redemptions')
    .select(`*, offer:reward_offers!reward_redemptions_offer_id_fkey(${OFFER_SELECT})`)
    .eq('user_id', userId)
    .order('redeemed_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as RewardRedemption[];
}

export async function getWallet(userId: string, limit = 50): Promise<WalletTransaction[]> {
  const { data, error } = await supabase
    .from('wallet_transactions')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as WalletTransaction[];
}

export async function getPlacements(slot: PlacementSlot): Promise<SponsoredPlacement[]> {
  const { data, error } = await supabase
    .from('sponsored_placements')
    .select('*')
    .eq('slot', slot)
    .eq('is_active', true)
    .order('priority', { ascending: false });
  if (error) throw error;
  return (data ?? []) as SponsoredPlacement[];
}

/** Spend Kibble on an offer. All eligibility checks are enforced server-side. */
export async function redeemReward(offerId: string): Promise<RewardRedemption> {
  const { data, error } = await supabase.rpc('redeem_reward', { p_offer: offerId });
  if (error) throw error;
  return data as RewardRedemption;
}

export interface Eligibility {
  ok: boolean;
  /** Short reason a locked offer can't be redeemed yet (for display only). */
  reason?: string;
}

/**
 * Display-time eligibility check. The `redeem_reward` RPC is the authoritative
 * gate — this just lets the UI show a lock state and why.
 */
export function checkEligibility(
  offer: RewardOffer,
  profile: Pick<Profile, 'kibble_balance' | 'level'> | null | undefined,
  earnedBadgeIds: Set<string>,
): Eligibility {
  if (!profile) return { ok: false, reason: 'Sign in to redeem' };
  if (offer.inventory != null && offer.redeemed_count >= offer.inventory) {
    return { ok: false, reason: 'Sold out' };
  }
  if (profile.level < offer.min_level) {
    return { ok: false, reason: `Reach level ${offer.min_level}` };
  }
  if (offer.required_badge_id && !earnedBadgeIds.has(offer.required_badge_id)) {
    return { ok: false, reason: 'Earn the required badge' };
  }
  if (profile.kibble_balance < offer.cost_kibble) {
    return { ok: false, reason: `Need ${offer.cost_kibble - profile.kibble_balance} more Kibble` };
  }
  return { ok: true };
}
