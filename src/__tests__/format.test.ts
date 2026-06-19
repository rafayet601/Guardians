import { compactNumber, formatDistance, initialsOf, levelProgress } from '@/utils/format';

describe('levelProgress (mirrors the DB level curve)', () => {
  it('starts at level 1 with 0 points', () => {
    const r = levelProgress(0);
    expect(r.level).toBe(1);
    expect(r.toNext).toBe(50);
    expect(r.progress).toBe(0);
  });

  it('reaches level 2 at 50 points', () => {
    expect(levelProgress(49).level).toBe(1);
    expect(levelProgress(50).level).toBe(2);
  });

  it('reaches level 3 at 200 points', () => {
    expect(levelProgress(199).level).toBe(2);
    expect(levelProgress(200).level).toBe(3);
  });

  it('clamps negative points to level 1', () => {
    expect(levelProgress(-100).level).toBe(1);
  });

  it('keeps progress within [0, 1]', () => {
    const r = levelProgress(120);
    expect(r.progress).toBeGreaterThanOrEqual(0);
    expect(r.progress).toBeLessThanOrEqual(1);
  });
});

describe('compactNumber', () => {
  it('formats across magnitudes', () => {
    expect(compactNumber(999)).toBe('999');
    expect(compactNumber(1200)).toBe('1.2k');
    expect(compactNumber(15000)).toBe('15k');
    expect(compactNumber(1_000_000)).toBe('1.0M');
  });
});

describe('formatDistance', () => {
  it('uses meters under 1km', () => {
    expect(formatDistance(850)).toBe('850 m');
  });
  it('uses one decimal km under 10km', () => {
    expect(formatDistance(2300)).toBe('2.3 km');
  });
  it('rounds km at/over 10km', () => {
    expect(formatDistance(15000)).toBe('15 km');
  });
  it('returns empty for non-finite input', () => {
    expect(formatDistance(Infinity)).toBe('');
  });
});

describe('initialsOf', () => {
  it('falls back to a paw for empty names', () => {
    expect(initialsOf(null)).toBe('🐾');
    expect(initialsOf('')).toBe('🐾');
  });
  it('takes two letters from a single name', () => {
    expect(initialsOf('catlover')).toBe('CA');
  });
  it('uses first + last initials', () => {
    expect(initialsOf('Jane Doe')).toBe('JD');
  });
});
