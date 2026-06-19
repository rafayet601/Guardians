/**
 * Domain model types — mirror the Postgres schema in supabase/migrations.
 *
 * (If you prefer fully generated types, run
 *  `supabase gen types typescript --linked > src/types/database.ts`
 *  and import from there. These hand-written types keep the app readable.)
 */

export type CatStatus =
  | 'spotted'
  | 'claimed'
  | 'in_rescue'
  | 'safe'
  | 'available'
  | 'adopted'
  | 'archived';

export type CatTemperament = 'friendly' | 'shy' | 'feral' | 'unknown';

export type UpdateType = 'comment' | 'status_change' | 'photo' | 'claim' | 'system';

export interface Profile {
  id: string;
  username: string;
  full_name: string | null;
  avatar_url: string | null;
  bio: string | null;
  is_guardian: boolean;
  wants_to_adopt: boolean;
  points: number;
  /** Spendable balance for the rewards marketplace (earned 1:1 with points). */
  kibble_balance: number;
  level: number;
  reports_count: number;
  rescues_count: number;
  adoptions_count: number;
  created_at: string;
  updated_at: string;
}

/** A profile summary embedded in joined queries. */
export interface ProfileRef {
  id: string;
  username: string;
  avatar_url: string | null;
  level: number;
}

export interface Sighting {
  id: string;
  reporter_id: string | null;
  title: string | null;
  description: string | null;
  lat: number;
  lng: number;
  address: string | null;
  status: CatStatus;
  temperament: CatTemperament;
  color: string | null;
  is_injured: boolean;
  needs_urgent_help: boolean;
  claimed_by: string | null;
  claimed_at: string | null;
  rescued_at: string | null;
  created_at: string;
  updated_at: string;
  /**
   * True only when the viewer is the reporter or assigned guardian; false when
   * `lat`/`lng` have been coarsened (~110m) for privacy. Present on the single
   * detail fetch (get_sighting_detail RPC); undefined on list/feed reads.
   */
  is_precise?: boolean;
  reporter?: ProfileRef | null;
  claimer?: ProfileRef | null;
  photos?: SightingPhoto[];
}

/** Shape returned by the `nearby_sightings` RPC. */
export interface NearbySighting {
  id: string;
  lat: number;
  lng: number;
  title: string | null;
  status: CatStatus;
  temperament: CatTemperament;
  color: string | null;
  is_injured: boolean;
  needs_urgent_help: boolean;
  created_at: string;
  distance_m: number;
  reporter_id: string | null;
  reporter_username: string | null;
  thumbnail_url: string | null;
}

export interface SightingPhoto {
  id: string;
  sighting_id: string;
  url: string;
  uploaded_by: string | null;
  created_at: string;
}

export interface SightingUpdate {
  id: string;
  sighting_id: string;
  author_id: string | null;
  type: UpdateType;
  body: string | null;
  old_status: CatStatus | null;
  new_status: CatStatus | null;
  created_at: string;
  author?: ProfileRef | null;
}

export interface AdoptionInterest {
  id: string;
  sighting_id: string;
  user_id: string;
  message: string | null;
  status: 'pending' | 'approved' | 'declined' | 'withdrawn';
  created_at: string;
  applicant?: ProfileRef | null;
}

export interface Badge {
  id: string;
  name: string;
  description: string;
  icon: string;
  sort_order: number;
}

export interface UserBadge {
  user_id: string;
  badge_id: string;
  awarded_at: string;
  badge?: Badge;
}

export interface LeaderboardEntry {
  id: string;
  username: string;
  avatar_url: string | null;
  points: number;
  level: number;
  rescues_count: number;
  rank: number;
}

// ---------------------------------------------------------------------------
// Rewards marketplace
// ---------------------------------------------------------------------------

export interface RewardBrand {
  id: string;
  name: string;
  blurb: string | null;
  logo_url: string | null;
  website: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface RewardOffer {
  id: string;
  brand_id: string;
  title: string;
  description: string | null;
  image_url: string | null;
  discount_label: string | null;
  cost_kibble: number;
  min_level: number;
  required_badge_id: string | null;
  inventory: number | null;
  redeemed_count: number;
  once_per_user: boolean;
  starts_at: string | null;
  ends_at: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  brand?: RewardBrand | null;
}

export interface RewardRedemption {
  id: string;
  user_id: string;
  offer_id: string;
  cost_kibble: number;
  code: string;
  status: 'active' | 'used' | 'expired';
  redeemed_at: string;
  expires_at: string | null;
  offer?: RewardOffer | null;
}

export interface WalletTransaction {
  id: string;
  user_id: string;
  amount: number;
  reason: string;
  kind: 'earn' | 'redeem' | 'adjust';
  redemption_id: string | null;
  created_at: string;
}

export type PlacementSlot = 'feed_card' | 'rewards_banner';

export interface SponsoredPlacement {
  id: string;
  brand_id: string | null;
  slot: PlacementSlot;
  title: string;
  body: string | null;
  image_url: string | null;
  cta_label: string | null;
  cta_url: string | null;
  priority: number;
  starts_at: string | null;
  ends_at: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}
