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
import { getAdoptionDraft, getReportAutofill } from '@/api/ai';

jest.mock('@/lib/supabase', () => ({
  supabase: { rpc: jest.fn(), functions: { invoke: jest.fn() } },
}));

const rpc = supabase.rpc as unknown as jest.Mock;
const invoke = supabase.functions.invoke as unknown as jest.Mock;

beforeEach(() => {
  rpc.mockReset();
  rpc.mockResolvedValue({ data: {}, error: null });
  invoke.mockReset();
  invoke.mockResolvedValue({ data: {}, error: null });
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

describe('API client → Edge Function invocation', () => {
  it('getReportAutofill → ai-report-autofill with the photo body', async () => {
    invoke.mockResolvedValue({
      data: {
        suggestion: {
          title: 'Tabby',
          description: 'An orange cat.',
          color: 'orange',
          marks: 'torn ear',
          temperament: 'shy',
          is_injured: true,
        },
      },
      error: null,
    });
    const result = await getReportAutofill({ imageBase64: 'AAAA', mediaType: 'image/png' });
    expect(invoke).toHaveBeenCalledWith('ai-report-autofill', {
      body: { imageBase64: 'AAAA', mediaType: 'image/png' },
    });
    // snake_case is_injured is normalised to camelCase isInjured for the client.
    expect(result).toEqual({
      title: 'Tabby',
      description: 'An orange cat.',
      color: 'orange',
      marks: 'torn ear',
      temperament: 'shy',
      isInjured: true,
    });
  });

  it('getReportAutofill coerces an out-of-enum temperament to unknown', async () => {
    invoke.mockResolvedValue({
      data: { suggestion: { temperament: 'grumpy', is_injured: false } },
      error: null,
    });
    const result = await getReportAutofill({ imageBase64: 'AAAA' });
    expect(result.temperament).toBe('unknown');
    expect(result.isInjured).toBe(false);
  });

  it('getReportAutofill propagates Edge Function errors (e.g. rate limit)', async () => {
    invoke.mockResolvedValue({ data: null, error: new Error('rate_limited') });
    await expect(getReportAutofill({ imageBase64: 'AAAA' })).rejects.toThrow('rate_limited');
  });

  it('getAdoptionDraft → ai-adoption-copy with the sighting id', async () => {
    invoke.mockResolvedValue({
      data: { draft: '  A gentle tabby looking for home.  ' },
      error: null,
    });
    const result = await getAdoptionDraft('s1');
    expect(invoke).toHaveBeenCalledWith('ai-adoption-copy', { body: { sighting_id: 's1' } });
    // the wrapper trims the draft body
    expect(result).toEqual({ draft: 'A gentle tabby looking for home.' });
  });

  it('getAdoptionDraft throws when the draft is empty', async () => {
    invoke.mockResolvedValue({ data: { draft: '   ' }, error: null });
    await expect(getAdoptionDraft('s1')).rejects.toThrow('No draft returned.');
  });

  it('getAdoptionDraft propagates Edge Function errors (e.g. rate limit)', async () => {
    invoke.mockResolvedValue({ data: null, error: new Error('rate_limited') });
    await expect(getAdoptionDraft('s1')).rejects.toThrow('rate_limited');
  });
});
