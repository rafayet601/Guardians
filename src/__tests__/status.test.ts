import { NEXT_STATUSES, STATUS_META, STATUS_OPTIONS, TEMPERAMENT_META } from '@/constants/status';
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
  it('lets a claimed cat advance or be archived', () => {
    expect(NEXT_STATUSES.claimed).toEqual(['in_rescue', 'archived']);
  });

  it('omits states with no UI-driven forward transition', () => {
    // claim & adopt have dedicated actions; terminal states have none.
    expect(NEXT_STATUSES.spotted).toBeUndefined();
    expect(NEXT_STATUSES.adopted).toBeUndefined();
    expect(NEXT_STATUSES.archived).toBeUndefined();
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
