// checkEligibility is pure, but its module imports the supabase client; mock it
// so the unit test never touches the network/native storage.
import { checkEligibility } from '@/api/rewards';
import type { Profile, RewardOffer } from '@/types/models';

jest.mock('@/lib/supabase', () => ({ supabase: {} }));

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
    const r = checkEligibility(
      offer({ cost_kibble: 1000 }),
      profile({ kibble_balance: 100 }),
      new Set(),
    );
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/more Kibble/i);
  });
});

describe('checkEligibility mirrors the redeem_reward rules the server enforces', () => {
  const now = Date.parse('2026-06-15T12:00:00Z');
  const past = '2026-06-01T00:00:00Z';
  const future = '2026-07-01T00:00:00Z';

  it('blocks an offer that has already ended', () => {
    const r = checkEligibility(offer({ ends_at: past }), profile(), new Set(), { now });
    expect(r).toEqual({ ok: false, reason: 'Expired' });
  });

  it('blocks an offer that has not started yet', () => {
    const r = checkEligibility(offer({ starts_at: future }), profile(), new Set(), { now });
    expect(r).toEqual({ ok: false, reason: 'Not available yet' });
  });

  it('allows an offer inside its window', () => {
    const r = checkEligibility(offer({ starts_at: past, ends_at: future }), profile(), new Set(), {
      now,
    });
    expect(r.ok).toBe(true);
  });

  it('blocks a once-per-user offer the person already redeemed', () => {
    const r = checkEligibility(offer({ id: 'o1' }), profile(), new Set(), {
      redeemedOfferIds: new Set(['o1']),
    });
    expect(r).toEqual({ ok: false, reason: 'Already redeemed' });
  });

  it('lets a repeatable offer be redeemed again', () => {
    const r = checkEligibility(offer({ id: 'o1', once_per_user: false }), profile(), new Set(), {
      redeemedOfferIds: new Set(['o1']),
    });
    expect(r.ok).toBe(true);
  });

  it('does not confuse a different redeemed offer with this one', () => {
    const r = checkEligibility(offer({ id: 'o1' }), profile(), new Set(), {
      redeemedOfferIds: new Set(['other']),
    });
    expect(r.ok).toBe(true);
  });

  it('reports time limits before stock, level, badge and balance, like the server', () => {
    const r = checkEligibility(
      offer({ ends_at: past, inventory: 1, redeemed_count: 1, min_level: 9 }),
      profile({ kibble_balance: 0 }),
      new Set(),
      { now },
    );
    expect(r.reason).toBe('Expired');
  });

  it('keeps working with the original three-argument call', () => {
    expect(checkEligibility(offer(), profile(), new Set()).ok).toBe(true);
  });
});
