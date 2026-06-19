// checkEligibility is pure, but its module imports the supabase client; mock it
// so the unit test never touches the network/native storage.
jest.mock('@/lib/supabase', () => ({ supabase: {} }));

import { checkEligibility } from '@/api/rewards';
import type { Profile, RewardOffer } from '@/types/models';

const offer = (over: Partial<RewardOffer> = {}): RewardOffer => ({
  id: 'o1',
  brand_id: 'b1',
  title: 'Test offer',
  description: null,
  image_url: null,
  discount_label: null,
  cost_kibble: 100,
  min_level: 1,
  required_badge_id: null,
  inventory: null,
  redeemed_count: 0,
  once_per_user: true,
  starts_at: null,
  ends_at: null,
  is_active: true,
  created_at: '',
  updated_at: '',
  ...over,
});

const profile = (
  over: Partial<Pick<Profile, 'kibble_balance' | 'level'>> = {},
): Pick<Profile, 'kibble_balance' | 'level'> => ({ kibble_balance: 500, level: 3, ...over });

describe('checkEligibility', () => {
  it('blocks anonymous users', () => {
    expect(checkEligibility(offer(), null, new Set()).ok).toBe(false);
  });

  it('passes when every gate is satisfied', () => {
    expect(checkEligibility(offer(), profile(), new Set()).ok).toBe(true);
  });

  it('blocks a sold-out offer', () => {
    const r = checkEligibility(offer({ inventory: 5, redeemed_count: 5 }), profile(), new Set());
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/sold out/i);
  });

  it('blocks below the minimum level', () => {
    const r = checkEligibility(offer({ min_level: 5 }), profile({ level: 3 }), new Set());
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/level 5/i);
  });

  it('blocks when the required badge is missing', () => {
    const r = checkEligibility(offer({ required_badge_id: 'rescue_hero' }), profile(), new Set());
    expect(r.ok).toBe(false);
  });

  it('passes when the required badge is held', () => {
    const r = checkEligibility(
      offer({ required_badge_id: 'rescue_hero' }),
      profile(),
      new Set(['rescue_hero']),
    );
    expect(r.ok).toBe(true);
  });

  it('blocks when Kibble balance is too low', () => {
    const r = checkEligibility(offer({ cost_kibble: 1000 }), profile({ kibble_balance: 100 }), new Set());
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/more Kibble/i);
  });
});
