import { withoutBlocked } from '@/lib/blocking';

const report = (id: string, reporter_id: string | null) => ({ id, reporter_id });

describe('withoutBlocked', () => {
  const items = [report('1', 'a'), report('2', 'b'), report('3', 'a'), report('4', null)];

  it('hides every report by a blocked reporter', () => {
    expect(withoutBlocked(items, new Set(['a'])).map((i) => i.id)).toEqual(['2', '4']);
  });

  it('hides several blocked reporters at once', () => {
    expect(withoutBlocked(items, new Set(['a', 'b'])).map((i) => i.id)).toEqual(['4']);
  });

  it('returns everything when nobody is blocked', () => {
    expect(withoutBlocked(items, new Set())).toEqual(items);
  });

  it('never hides reports that have no reporter', () => {
    expect(withoutBlocked([report('x', null)], new Set(['a']))).toEqual([report('x', null)]);
  });

  it('does not mutate its input', () => {
    const copy = [...items];
    withoutBlocked(items, new Set(['a']));
    expect(items).toEqual(copy);
  });
});
