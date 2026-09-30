import { LAST_SEEN_OPTIONS, lastSeenIso, type LastSeenKey } from '@/utils/lostCat';

describe('lastSeenIso', () => {
  const now = Date.parse('2026-03-15T18:00:00Z');

  it('turns each choice into an ISO timestamp the right distance in the past', () => {
    expect(lastSeenIso('now', now)).toBe('2026-03-15T18:00:00.000Z');
    expect(lastSeenIso('hour', now)).toBe('2026-03-15T17:00:00.000Z');
    expect(lastSeenIso('today', now)).toBe('2026-03-15T12:00:00.000Z');
    expect(lastSeenIso('yesterday', now)).toBe('2026-03-14T18:00:00.000Z');
    expect(lastSeenIso('days', now)).toBe('2026-03-12T18:00:00.000Z');
  });

  it('always yields something Date can parse back, unlike the old typed format', () => {
    for (const o of LAST_SEEN_OPTIONS) {
      const iso = lastSeenIso(o.key, now);
      expect(Number.isNaN(new Date(iso).getTime())).toBe(false);
    }
  });

  it('never produces a time in the future, and orders the choices oldest last', () => {
    const times = LAST_SEEN_OPTIONS.map((o) => Date.parse(lastSeenIso(o.key, now)));
    times.forEach((t) => expect(t).toBeLessThanOrEqual(now));
    expect([...times].sort((a, b) => b - a)).toEqual(times);
  });

  it('falls back to "just now" for an unknown key', () => {
    expect(lastSeenIso('bogus' as LastSeenKey, now)).toBe('2026-03-15T18:00:00.000Z');
  });
});
