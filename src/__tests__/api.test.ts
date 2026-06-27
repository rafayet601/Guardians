/**
 * Contract tests for the API client: each wrapper must call the right Postgres
 * RPC with the exact `p_*` argument names the migrations expect. A rename on
 * either side breaks these — catching argument drift that `tsc` cannot see.
 */
import { supabase } from '@/lib/supabase';
import {
  approveAdoption,
  claimSighting,
  createSighting,
  expressInterest,
  getNearby,
  getSighting,
  updateStatus,
} from '@/api/sightings';
import { redeemReward } from '@/api/rewards';
import { upsertPushToken } from '@/api/push';

jest.mock('@/lib/supabase', () => ({ supabase: { rpc: jest.fn() } }));

const rpc = supabase.rpc as unknown as jest.Mock;

beforeEach(() => {
  rpc.mockReset();
  rpc.mockResolvedValue({ data: {}, error: null });
});

describe('API client → RPC argument mapping', () => {
  it('createSighting → create_sighting', async () => {
    await createSighting({ lat: 1, lng: 2, title: 'Tabby', temperament: 'shy', isInjured: true });
    expect(rpc).toHaveBeenCalledWith(
      'create_sighting',
      expect.objectContaining({
        p_lat: 1,
        p_lng: 2,
        p_title: 'Tabby',
        p_temperament: 'shy',
        p_is_injured: true,
      }),
    );
  });

  it('claimSighting → claim_sighting', async () => {
    await claimSighting('s1');
    expect(rpc).toHaveBeenCalledWith('claim_sighting', { p_sighting: 's1' });
  });

  it('updateStatus → update_sighting_status', async () => {
    await updateStatus('s1', 'safe', 'note');
    expect(rpc).toHaveBeenCalledWith('update_sighting_status', {
      p_sighting: 's1',
      p_new_status: 'safe',
      p_note: 'note',
    });
  });

  it('expressInterest → express_adoption_interest', async () => {
    await expressInterest('s1', 'hi');
    expect(rpc).toHaveBeenCalledWith('express_adoption_interest', {
      p_sighting: 's1',
      p_message: 'hi',
    });
  });

  it('approveAdoption → approve_adoption', async () => {
    await approveAdoption('i1');
    expect(rpc).toHaveBeenCalledWith('approve_adoption', { p_interest: 'i1' });
  });

  it('getNearby → nearby_sightings', async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    await getNearby({ lat: 1, lng: 2, radiusM: 3000 });
    expect(rpc).toHaveBeenCalledWith(
      'nearby_sightings',
      expect.objectContaining({ p_lat: 1, p_lng: 2, p_radius_m: 3000 }),
    );
  });

  it('getSighting → get_sighting_detail', async () => {
    await getSighting('s1');
    expect(rpc).toHaveBeenCalledWith('get_sighting_detail', { p_sighting: 's1' });
  });

  it('redeemReward → redeem_reward', async () => {
    await redeemReward('o1');
    expect(rpc).toHaveBeenCalledWith('redeem_reward', { p_offer: 'o1' });
  });

  it('upsertPushToken → upsert_push_token', async () => {
    await upsertPushToken('ExponentPushToken[abc]', { lat: 1, lng: 2 });
    expect(rpc).toHaveBeenCalledWith('upsert_push_token', {
      p_token: 'ExponentPushToken[abc]',
      p_lat: 1,
      p_lng: 2,
    });
  });

  it('propagates RPC errors', async () => {
    rpc.mockResolvedValue({ data: null, error: new Error('boom') });
    await expect(claimSighting('s1')).rejects.toThrow('boom');
  });
});
