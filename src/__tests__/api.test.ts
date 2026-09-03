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
import { setPushEnabled, upsertPushToken } from '@/api/push';
import {
  confirmLostCatMatch,
  confirmSightingLink,
  createLostCat,
  getAdoptionDraft,
  getLostCat,
  getLostCatMatches,
  getMyLostCats,
  getReidCandidates,
  getReportAutofill,
  getSightingLinks,
  rejectLostCatMatch,
  rejectSightingLink,
  triggerLostCatMatch,
  triggerSightingLostMatch,
} from '@/api/ai';
import { getMyProfile } from '@/api/profiles';
import { getLeaderboard } from '@/api/gamification';
import { reportContent, moderateContent, getBlockedUsers } from '@/api/moderation';

const mockChain = {
  select: jest.fn(),
  eq: jest.fn(),
  neq: jest.fn(),
  order: jest.fn(),
  limit: jest.fn(),
  in: jest.fn(),
  lt: jest.fn(),
  single: jest.fn(),
  insert: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
};
Object.values(mockChain).forEach((fn) => fn.mockReturnThis());

jest.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: jest.fn(),
    functions: { invoke: jest.fn() },
    from: jest.fn(() => mockChain),
    auth: { getUser: jest.fn() },
  },
}));

const rpc = supabase.rpc as unknown as jest.Mock;
const invoke = supabase.functions.invoke as unknown as jest.Mock;
const from = supabase.from as unknown as jest.Mock;
const getUser = supabase.auth.getUser as unknown as jest.Mock;

beforeEach(() => {
  rpc.mockReset();
  rpc.mockResolvedValue({ data: {}, error: null });
  invoke.mockReset();
  invoke.mockResolvedValue({ data: {}, error: null });
  from.mockReset();
  from.mockImplementation(() => mockChain);
  Object.values(mockChain).forEach((fn) => fn.mockReset().mockReturnThis());
  getUser.mockReset();
  getUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
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

  it('setPushEnabled → set_push_enabled', async () => {
    await setPushEnabled(false);
    expect(rpc).toHaveBeenCalledWith('set_push_enabled', { p_enabled: false });
  });

  it('propagates RPC errors', async () => {
    rpc.mockResolvedValue({ data: null, error: new Error('boom') });
    await expect(claimSighting('s1')).rejects.toThrow('boom');
  });

  it('reportContent → report_content', async () => {
    await reportContent('sighting', 's1', 'spam');
    expect(rpc).toHaveBeenCalledWith('report_content', {
      p_type: 'sighting',
      p_id: 's1',
      p_reason: 'spam',
    });
  });

  it('moderateContent → moderate_content', async () => {
    await moderateContent('comment', 'c1', true);
    expect(rpc).toHaveBeenCalledWith('moderate_content', {
      p_type: 'comment',
      p_id: 'c1',
      p_hide: true,
    });
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

/**
 * re-ID + lost-cat CRUD is RPC-only (0023/0025 SECURITY DEFINER functions).
 * The `ai-reid` / `ai-lost-match` Edge Functions implement no CRUD protocol —
 * routing a read through them 400s AND, for `ai-reid`, burns paid model spend.
 * Each test therefore asserts the exact `p_*` argument names AND that no edge
 * function was invoked.
 */
describe('re-ID + lost-cat CRUD → RPC argument mapping', () => {
  it('confirmSightingLink → confirm_sighting_link (never ai-reid)', async () => {
    rpc.mockResolvedValue({
      data: {
        id: 'l1',
        sighting_id: 's1',
        linked_sighting_id: 's2',
        confidence: 0.91,
        status: 'confirmed',
      },
      error: null,
    });
    const link = await confirmSightingLink('l1');
    expect(rpc).toHaveBeenCalledWith('confirm_sighting_link', { p_link: 'l1' });
    expect(invoke).not.toHaveBeenCalled();
    expect(link).toEqual({
      id: 'l1',
      sightingId: 's1',
      linkedSightingId: 's2',
      confidence: 0.91,
      status: 'confirmed',
    });
  });

  it('rejectSightingLink → reject_sighting_link (never ai-reid)', async () => {
    rpc.mockResolvedValue({
      data: {
        id: 'l1',
        sighting_id: 's1',
        linked_sighting_id: 's2',
        confidence: 0.4,
        status: 'rejected',
      },
      error: null,
    });
    const link = await rejectSightingLink('l1');
    expect(rpc).toHaveBeenCalledWith('reject_sighting_link', { p_link: 'l1' });
    expect(invoke).not.toHaveBeenCalled();
    expect(link.status).toBe('rejected');
  });

  it('getSightingLinks → get_sighting_links (never ai-reid — that would re-run the paid pipeline)', async () => {
    rpc.mockResolvedValue({
      data: [
        {
          id: 'l1',
          sighting_id: 's1',
          linked_sighting_id: 's2',
          confidence: 0.77,
          status: 'confirmed',
          created_at: '2026-01-01T00:00:00Z',
          title: 'Tabby again',
          thumbnail_url: 'https://cdn/1.jpg',
        },
      ],
      error: null,
    });
    const links = await getSightingLinks('s1');
    expect(rpc).toHaveBeenCalledWith('get_sighting_links', { p_sighting: 's1' });
    expect(invoke).not.toHaveBeenCalled();
    expect(links).toEqual([
      {
        id: 'l1',
        sightingId: 's1',
        linkedSightingId: 's2',
        confidence: 0.77,
        status: 'confirmed',
      },
    ]);
  });

  it('createLostCat → create_lost_cat with the p_* coordinate args', async () => {
    rpc.mockResolvedValue({
      data: {
        id: 'lc1',
        owner_id: 'u1',
        title: 'Miso',
        description: 'Orange, torn ear',
        photo_url: 'https://cdn/miso.jpg',
        lat: 1,
        lng: 2,
        last_seen_at: '2026-01-01T00:00:00Z',
        status: 'open',
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      },
      error: null,
    });
    const post = await createLostCat({
      lat: 1,
      lng: 2,
      lastSeenAt: '2026-01-01T00:00:00Z',
      title: 'Miso',
      description: 'Orange, torn ear',
      photoUrl: 'https://cdn/miso.jpg',
    });
    expect(rpc).toHaveBeenCalledWith('create_lost_cat', {
      p_lat: 1,
      p_lng: 2,
      p_last_seen_at: '2026-01-01T00:00:00Z',
      p_title: 'Miso',
      p_description: 'Orange, torn ear',
      p_photo_url: 'https://cdn/miso.jpg',
    });
    expect(invoke).not.toHaveBeenCalled();
    // owner_id → user_id, lat/lng → lastSeenLat/lastSeenLng, photo_url → photoUrl
    expect(post).toEqual({
      id: 'lc1',
      user_id: 'u1',
      title: 'Miso',
      description: 'Orange, torn ear',
      photoUrl: 'https://cdn/miso.jpg',
      lastSeenLat: 1,
      lastSeenLng: 2,
      lastSeenAt: '2026-01-01T00:00:00Z',
      status: 'open',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    });
  });

  it('createLostCat defaults p_last_seen_at (the RPC rejects null)', async () => {
    await createLostCat({ lat: 1, lng: 2, photoUrl: 'https://cdn/miso.jpg' }).catch(() => {});
    expect(rpc).toHaveBeenCalledWith(
      'create_lost_cat',
      expect.objectContaining({
        p_last_seen_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
        p_title: null,
        p_description: null,
      }),
    );
  });

  it('getMyLostCats → get_my_lost_cats (no args)', async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    await getMyLostCats();
    expect(rpc).toHaveBeenCalledWith('get_my_lost_cats', {});
    expect(invoke).not.toHaveBeenCalled();
  });

  it('getLostCat → get_lost_cat', async () => {
    rpc.mockResolvedValue({
      data: {
        id: 'lc1',
        owner_id: 'u1',
        title: null,
        description: null,
        photo_url: null,
        lat: 1,
        lng: 2,
        last_seen_at: null,
        status: 'matched',
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      },
      error: null,
    });
    const post = await getLostCat('lc1');
    expect(rpc).toHaveBeenCalledWith('get_lost_cat', { p_id: 'lc1' });
    expect(invoke).not.toHaveBeenCalled();
    expect(post.status).toBe('matched');
    expect(post.title).toBe('');
  });

  it('getLostCatMatches → get_lost_cat_matches and maps the display columns', async () => {
    rpc.mockResolvedValue({
      data: [
        {
          id: 'm1',
          lost_cat_id: 'lc1',
          sighting_id: 's1',
          confidence: 0.82,
          distance_m: 412,
          status: 'suggested',
          created_at: '2026-01-02T00:00:00Z',
          sighting_title: 'Orange tabby on Elm',
          sighting_thumbnail_url: 'https://cdn/s1.jpg',
          sighting_created_at: '2026-01-01T12:00:00Z',
        },
      ],
      error: null,
    });
    const matches = await getLostCatMatches('lc1');
    expect(rpc).toHaveBeenCalledWith('get_lost_cat_matches', { p_lost_cat: 'lc1' });
    expect(invoke).not.toHaveBeenCalled();
    expect(matches[0]).toEqual({
      id: 'm1',
      lost_cat_id: 'lc1',
      sighting_id: 's1',
      confidence: 0.82,
      status: 'suggested',
      created_at: '2026-01-02T00:00:00Z',
      createdAt: '2026-01-02T00:00:00Z',
      distanceM: 412,
      sightingTitle: 'Orange tabby on Elm',
      sightingThumbnailUrl: 'https://cdn/s1.jpg',
      sightingCreatedAt: '2026-01-01T12:00:00Z',
    });
  });

  it('confirmLostCatMatch → confirm_lost_cat_match', async () => {
    rpc.mockResolvedValue({
      data: {
        id: 'm1',
        lost_cat_id: 'lc1',
        sighting_id: 's1',
        confidence: 0.82,
        status: 'confirmed',
        created_at: '2026-01-02T00:00:00Z',
      },
      error: null,
    });
    const match = await confirmLostCatMatch('m1');
    expect(rpc).toHaveBeenCalledWith('confirm_lost_cat_match', { p_match: 'm1' });
    expect(invoke).not.toHaveBeenCalled();
    expect(match.status).toBe('confirmed');
  });

  it('rejectLostCatMatch → reject_lost_cat_match', async () => {
    rpc.mockResolvedValue({
      data: {
        id: 'm1',
        lost_cat_id: 'lc1',
        sighting_id: 's1',
        confidence: null,
        status: 'rejected',
        created_at: '2026-01-02T00:00:00Z',
      },
      error: null,
    });
    const match = await rejectLostCatMatch('m1');
    expect(rpc).toHaveBeenCalledWith('reject_lost_cat_match', { p_match: 'm1' });
    expect(match.status).toBe('rejected');
    expect(match.confidence).toBe(0);
  });

  it('propagates RPC errors from the lost-cat helpers', async () => {
    rpc.mockResolvedValue({ data: null, error: new Error('Not authenticated') });
    await expect(getMyLostCats()).rejects.toThrow('Not authenticated');
  });
});

/**
 * The AI pipeline is the ONLY thing the edge functions do. `ai-reid` parses
 * `sighting_id` alone and answers with a `{ candidates }` envelope of
 * snake_case rows; `ai-lost-match` requires `mode`.
 */
describe('AI pipeline → Edge Function invocation', () => {
  it('getReidCandidates → ai-reid with sighting_id only, unwrapping the envelope', async () => {
    invoke.mockResolvedValue({
      data: {
        candidates: [
          {
            linked_sighting_id: 's2',
            title: 'Same tabby?',
            thumbnail_url: 'https://cdn/s2.jpg',
            status: 'suggested',
            created_at: '2026-01-01T00:00:00Z',
            distance_m: 1200,
            confidence: 0.83,
            link_id: 'l1',
          },
        ],
      },
      error: null,
    });
    const candidates = await getReidCandidates('s1');
    // No `action` key — ai-reid has no action handling and 400s on anything else.
    expect(invoke).toHaveBeenCalledWith('ai-reid', { body: { sighting_id: 's1' } });
    expect(Array.isArray(candidates)).toBe(true);
    expect(candidates).toEqual([
      {
        linkId: 'l1',
        // threaded through from the caller — the server row has no sighting_id
        sightingId: 's1',
        linkedSightingId: 's2',
        confidence: 0.83,
        status: 'suggested',
        title: 'Same tabby?',
        thumbnailUrl: 'https://cdn/s2.jpg',
        distanceM: 1200,
      },
    ]);
  });

  it('getReidCandidates returns an empty array for the empty envelope', async () => {
    invoke.mockResolvedValue({ data: { candidates: [] }, error: null });
    await expect(getReidCandidates('s1')).resolves.toEqual([]);
  });

  it.each([
    ['null data', null],
    ['a bare object', {}],
    ['a non-array candidates value', { candidates: 'nope' }],
    ['a top-level array (pre-envelope shape)', [{ linked_sighting_id: 's2' }]],
    ['a string body', 'boom'],
  ])('getReidCandidates survives %s without throwing', async (_label, data) => {
    invoke.mockResolvedValue({ data, error: null });
    // A non-array here is what crashed ReidSuggestions' `.map` — always a list.
    await expect(getReidCandidates('s1')).resolves.toEqual([]);
  });

  it('getReidCandidates propagates Edge Function errors', async () => {
    invoke.mockResolvedValue({ data: null, error: new Error('Forbidden') });
    await expect(getReidCandidates('s1')).rejects.toThrow('Forbidden');
  });

  it('triggerLostCatMatch → ai-lost-match with mode lost_cat', async () => {
    await triggerLostCatMatch('lc1');
    expect(invoke).toHaveBeenCalledWith('ai-lost-match', {
      body: { mode: 'lost_cat', lost_cat_id: 'lc1' },
    });
  });

  it('triggerSightingLostMatch → ai-lost-match with mode sighting', async () => {
    await triggerSightingLostMatch('s1');
    expect(invoke).toHaveBeenCalledWith('ai-lost-match', {
      body: { mode: 'sighting', sighting_id: 's1' },
    });
  });

  it('triggerLostCatMatch propagates Edge Function errors', async () => {
    invoke.mockResolvedValue({ data: null, error: new Error('rate_limited') });
    await expect(triggerLostCatMatch('lc1')).rejects.toThrow('rate_limited');
  });
});

describe('API client → table queries', () => {
  it('getMyProfile → profiles table for the current user', async () => {
    const profile = { id: 'u1', username: 'alice' };
    mockChain.single.mockResolvedValueOnce({ data: profile, error: null });
    const result = await getMyProfile();
    expect(from).toHaveBeenCalledWith('profiles');
    expect(mockChain.select).toHaveBeenCalled();
    expect(mockChain.eq).toHaveBeenCalledWith('id', 'u1');
    expect(mockChain.single).toHaveBeenCalled();
    expect(result).toEqual(profile);
  });

  it('getLeaderboard → profiles table ordered by points desc', async () => {
    const rows = [
      { id: 'u1', points: 100 },
      { id: 'u2', points: 50 },
    ];
    mockChain.limit.mockResolvedValueOnce({ data: rows, error: null });
    const result = await getLeaderboard();
    expect(from).toHaveBeenCalledWith('profiles');
    expect(mockChain.select).toHaveBeenCalled();
    expect(mockChain.order).toHaveBeenCalledWith('points', { ascending: false });
    expect(mockChain.order).toHaveBeenCalledWith('rescues_count', { ascending: false });
    expect(mockChain.limit).toHaveBeenCalledWith(50);
    expect(result).toEqual([
      { id: 'u1', points: 100, rank: 1 },
      { id: 'u2', points: 50, rank: 2 },
    ]);
  });

  it('getBlockedUsers → user_blocks joined to the blocked profile', async () => {
    const rows = [
      {
        blocked_id: 'u2',
        created_at: '2026-01-01T00:00:00Z',
        blocked: { id: 'u2', username: 'bob', full_name: 'Bob B', avatar_url: null },
      },
    ];
    mockChain.order.mockResolvedValueOnce({ data: rows, error: null });
    const result = await getBlockedUsers();
    expect(from).toHaveBeenCalledWith('user_blocks');
    expect(mockChain.select).toHaveBeenCalledWith(
      expect.stringContaining('profiles!user_blocks_blocked_id_fkey'),
    );
    expect(mockChain.eq).toHaveBeenCalledWith('blocker_id', 'u1');
    expect(mockChain.order).toHaveBeenCalledWith('created_at', { ascending: false });
    expect(result).toEqual([
      {
        blocked_id: 'u2',
        blocked_at: '2026-01-01T00:00:00Z',
        username: 'bob',
        full_name: 'Bob B',
        avatar_url: null,
      },
    ]);
  });
});
