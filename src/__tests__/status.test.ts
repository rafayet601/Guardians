import {
  CLAIM_STALE_HOURS,
  NEXT_STATUSES,
  STATUS_META,
  STATUS_OPTIONS,
  TEMPERAMENT_META,
  getStatusActions,
  isClaimStale,
  isUrgentNow,
} from '@/constants/status';
import type { CatStatus } from '@/types/models';

const ALL_STATUSES: CatStatus[] = [
  'spotted',
  'claimed',
  'in_rescue',
  'safe',
  'available',
  'adopted',
  'archived',
];

describe('STATUS_META', () => {
  it('has label + icon + description for every status', () => {
    for (const s of ALL_STATUSES) {
      expect(STATUS_META[s]).toBeDefined();
      expect(STATUS_META[s].label).toBeTruthy();
      expect(STATUS_META[s].icon).toBeTruthy();
      expect(STATUS_META[s].description).toBeTruthy();
    }
  });
});

describe('NEXT_STATUSES (client mirror of is_valid_transition)', () => {
  it('lets a claimed cat advance, be released back to spotted, or be archived', () => {
    expect(NEXT_STATUSES.claimed).toEqual(['in_rescue', 'spotted', 'archived']);
  });

  it('lets a reporter withdraw a spotted report but never offers the dedicated claim action', () => {
    expect(NEXT_STATUSES.spotted).toEqual(['archived']);
  });

  it('omits states with no UI-driven transition', () => {
    // adopt has a dedicated action; terminal states have none.
    expect(NEXT_STATUSES.adopted).toBeUndefined();
    expect(NEXT_STATUSES.archived).toBeUndefined();
  });

  it('never offers the dedicated-action statuses or a regression that re-sends pushes', () => {
    Object.values(NEXT_STATUSES).forEach((targets) => {
      expect(targets).not.toContain('claimed');
      expect(targets).not.toContain('adopted');
    });
    expect(NEXT_STATUSES.in_rescue).not.toContain('claimed');
  });

  it('never lists a status transitioning to itself', () => {
    (Object.keys(NEXT_STATUSES) as CatStatus[]).forEach((from) => {
      expect(NEXT_STATUSES[from]).not.toContain(from);
    });
  });

  it('only targets known statuses', () => {
    Object.values(NEXT_STATUSES).forEach((targets) => {
      targets?.forEach((t) => expect(ALL_STATUSES).toContain(t));
    });
  });
});

describe('isUrgentNow', () => {
  it('only reads as urgent while the cat still needs a Guardian', () => {
    expect(isUrgentNow('spotted', true)).toBe(true);
    for (const s of ['claimed', 'in_rescue', 'safe', 'available', 'adopted', 'archived'] as const) {
      expect(isUrgentNow(s, true)).toBe(false);
    }
  });

  it('is false when the reporter never flagged urgency', () => {
    expect(isUrgentNow('spotted', false)).toBe(false);
    expect(isUrgentNow('spotted', undefined)).toBe(false);
  });
});

describe('isClaimStale', () => {
  const now = Date.parse('2026-01-10T12:00:00Z');
  const hoursAgo = (h: number) => new Date(now - h * 3_600_000).toISOString();

  it('is stale once nothing has happened for the threshold', () => {
    expect(isClaimStale(hoursAgo(30), hoursAgo(CLAIM_STALE_HOURS), now)).toBe(true);
    expect(isClaimStale(hoursAgo(30), hoursAgo(CLAIM_STALE_HOURS + 5), now)).toBe(true);
  });

  it('is fresh while there is recent activity, even on an old claim', () => {
    expect(isClaimStale(hoursAgo(72), hoursAgo(2), now)).toBe(false);
  });

  it('falls back to the claim time when there is no activity yet', () => {
    expect(isClaimStale(hoursAgo(30), null, now)).toBe(true);
    expect(isClaimStale(hoursAgo(1), undefined, now)).toBe(false);
  });

  it('is never stale without a usable timestamp', () => {
    expect(isClaimStale(null, null, now)).toBe(false);
    expect(isClaimStale('not-a-date', 'also-not', now)).toBe(false);
  });
});

describe('getStatusActions', () => {
  const guardian = { isOwner: false, isClaimer: true };
  const reporter = { isOwner: true, isClaimer: false };
  const targets = (from: CatStatus, ctx: Parameters<typeof getStatusActions>[1]) =>
    getStatusActions(from, ctx).map((a) => a.status);

  it('shows nothing to people who do not manage the cat', () => {
    expect(getStatusActions('claimed', { isOwner: false, isClaimer: false })).toEqual([]);
    expect(getStatusActions('spotted', { isOwner: false, isClaimer: false })).toEqual([]);
  });

  it('gives the assigned Guardian a way to release a claim they cannot fulfil', () => {
    const release = getStatusActions('claimed', guardian).find((a) => a.status === 'spotted');
    expect(release).toBeDefined();
    expect(release?.label).toMatch(/release/i);
    expect(release?.destructive).toBeFalsy();
    expect(release?.note).toBeTruthy();
  });

  it('only lets the reporter reopen a claimed cat once the Guardian has gone quiet', () => {
    expect(targets('claimed', reporter)).toEqual(['in_rescue', 'archived']);
    expect(targets('claimed', { ...reporter, claimStale: true })).toEqual([
      'in_rescue',
      'spotted',
      'archived',
    ]);
  });

  it('treats a reporter who claimed their own cat as the Guardian (release, not reopen)', () => {
    const both = { isOwner: true, isClaimer: true };
    const release = getStatusActions('claimed', both).find((a) => a.status === 'spotted');
    expect(release?.label).toMatch(/release/i);
  });

  it('lets only the reporter withdraw a report nobody has claimed', () => {
    expect(targets('spotted', reporter)).toEqual(['archived']);
    expect(targets('spotted', guardian)).toEqual([]);
    const close = getStatusActions('spotted', reporter)[0];
    expect(close.destructive).toBe(true);
  });

  it('always confirms closing as destructive and records who closed it', () => {
    for (const from of ['claimed', 'in_rescue', 'safe', 'available'] as const) {
      const close = getStatusActions(from, guardian).find((a) => a.status === 'archived');
      expect(close?.destructive).toBe(true);
      expect(close?.note).toContain('guardian');
    }
    const byReporter = getStatusActions('in_rescue', reporter).find((a) => a.status === 'archived');
    expect(byReporter?.note).toContain('reporter');
  });

  it('describes pulling a listing as pausing it, not as marking the cat safe', () => {
    const pause = getStatusActions('available', reporter).find((a) => a.status === 'safe');
    expect(pause?.label).toBe('Pause adoption listing');
    expect(pause?.variant).toBe('outline');
  });

  it('keeps forward progress as the primary action and puts closing last', () => {
    const actions = getStatusActions('claimed', guardian);
    expect(actions[0].status).toBe('in_rescue');
    expect(actions[0].variant).toBe('primary');
    expect(actions[actions.length - 1].status).toBe('archived');
  });

  it('never offers a transition the database rejects', () => {
    // Client mirror of is_valid_transition + update_sighting_status's guards.
    const valid: Record<string, CatStatus[]> = {
      spotted: ['archived'],
      claimed: ['in_rescue', 'spotted', 'archived'],
      in_rescue: ['safe', 'claimed', 'archived'],
      safe: ['available', 'in_rescue', 'archived'],
      available: ['safe', 'archived'],
    };
    for (const from of Object.keys(valid) as CatStatus[]) {
      for (const ctx of [guardian, reporter, { ...reporter, claimStale: true }]) {
        for (const a of getStatusActions(from, ctx)) {
          expect(valid[from]).toContain(a.status);
          expect(['claimed', 'adopted']).not.toContain(a.status);
        }
      }
    }
  });
});

describe('reference data', () => {
  it('STATUS_OPTIONS excludes archived', () => {
    expect(STATUS_OPTIONS).not.toContain('archived');
  });
  it('covers every temperament', () => {
    (['friendly', 'shy', 'feral', 'unknown'] as const).forEach((t) => {
      expect(TEMPERAMENT_META[t]).toBeDefined();
    });
  });
});
