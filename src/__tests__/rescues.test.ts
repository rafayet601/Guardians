import { isActiveRescue, sortRescues } from '@/utils/rescues';
import type { CatStatus } from '@/types/models';

const rescue = (id: string, status: CatStatus, claimed_at: string | null) => ({
  id,
  status,
  claimed_at,
});

describe('isActiveRescue', () => {
  it('is true only while the Guardian still has work to do', () => {
    expect(isActiveRescue('claimed')).toBe(true);
    expect(isActiveRescue('in_rescue')).toBe(true);
    for (const s of ['spotted', 'safe', 'available', 'adopted', 'archived'] as const) {
      expect(isActiveRescue(s)).toBe(false);
    }
  });
});

describe('sortRescues', () => {
  it('puts open commitments first, then cats in care, then adopted ones', () => {
    const sorted = sortRescues([
      rescue('adopted', 'adopted', '2026-01-05T00:00:00Z'),
      rescue('safe', 'safe', '2026-01-04T00:00:00Z'),
      rescue('active', 'in_rescue', '2026-01-01T00:00:00Z'),
    ]);
    expect(sorted.map((r) => r.id)).toEqual(['active', 'safe', 'adopted']);
  });

  it('orders by newest claim within a group', () => {
    const sorted = sortRescues([
      rescue('old', 'claimed', '2026-01-01T00:00:00Z'),
      rescue('new', 'in_rescue', '2026-01-09T00:00:00Z'),
    ]);
    expect(sorted.map((r) => r.id)).toEqual(['new', 'old']);
  });

  it('copes with a missing claim time and never mutates its input', () => {
    const input = [rescue('a', 'safe', null), rescue('b', 'safe', '2026-01-02T00:00:00Z')];
    const snapshot = input.map((r) => r.id);
    expect(sortRescues(input).map((r) => r.id)).toEqual(['b', 'a']);
    expect(input.map((r) => r.id)).toEqual(snapshot);
  });
});
