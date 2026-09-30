import { sortForTriage, triageRank } from '@/utils/triage';
import type { CatStatus } from '@/types/models';

const cat = (
  id: string,
  status: CatStatus,
  distance_m: number,
  flags: { urgent?: boolean; injured?: boolean } = {},
) => ({
  id,
  status,
  distance_m,
  needs_urgent_help: !!flags.urgent,
  is_injured: !!flags.injured,
});

describe('triageRank', () => {
  it('ranks cats that still need a Guardian ahead of everything else', () => {
    const order = [
      triageRank(cat('a', 'spotted', 0, { urgent: true })),
      triageRank(cat('b', 'spotted', 0, { injured: true })),
      triageRank(cat('c', 'spotted', 0)),
      triageRank(cat('d', 'claimed', 0)),
      triageRank(cat('e', 'available', 0)),
      triageRank(cat('f', 'safe', 0)),
      triageRank(cat('g', 'adopted', 0)),
    ];
    expect(order).toEqual([...order].sort((x, y) => x - y));
    expect(new Set(order).size).toBe(7);
  });

  it('treats claimed and in-rescue cats as equally handled', () => {
    expect(triageRank(cat('a', 'claimed', 0))).toBe(triageRank(cat('b', 'in_rescue', 0)));
  });

  it('ignores the urgent flag once a Guardian is on the cat', () => {
    expect(triageRank(cat('a', 'claimed', 0, { urgent: true }))).toBe(
      triageRank(cat('b', 'claimed', 0)),
    );
  });
});

describe('sortForTriage', () => {
  it('puts a far urgent cat before a near resolved one', () => {
    const sorted = sortForTriage([
      cat('near-safe', 'safe', 100),
      cat('near-adopted', 'adopted', 50),
      cat('far-urgent', 'spotted', 4000, { urgent: true }),
    ]);
    expect(sorted.map((c) => c.id)).toEqual(['far-urgent', 'near-safe', 'near-adopted']);
  });

  it('orders by distance within a tier', () => {
    const sorted = sortForTriage([
      cat('b', 'spotted', 900),
      cat('a', 'spotted', 100),
      cat('c', 'spotted', 500),
    ]);
    expect(sorted.map((c) => c.id)).toEqual(['a', 'c', 'b']);
  });

  it('does not mutate its input', () => {
    const input = [cat('b', 'safe', 5), cat('a', 'spotted', 9, { urgent: true })];
    const snapshot = input.map((c) => c.id);
    sortForTriage(input);
    expect(input.map((c) => c.id)).toEqual(snapshot);
  });

  it('keeps the cap from hiding urgent cats behind resolved ones', () => {
    const many = Array.from({ length: 40 }, (_, i) => cat(`safe-${i}`, 'safe', i));
    const urgent = cat('urgent', 'spotted', 9999, { urgent: true });
    const firstPage = sortForTriage([...many, urgent]).slice(0, 25);
    expect(firstPage.map((c) => c.id)).toContain('urgent');
  });
});
