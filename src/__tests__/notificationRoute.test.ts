import { notificationRoute, notificationSightingId } from '@/lib/notificationRoute';

const ID = '11111111-1111-4111-8111-111111111111';

describe('notificationRoute', () => {
  it('opens the sighting for lifecycle and urgent pushes', () => {
    expect(notificationRoute({ sighting_id: ID })).toBe(`/sighting/${ID}`);
    expect(notificationRoute({ sighting_id: ID, type: 'urgent_sighting' })).toBe(`/sighting/${ID}`);
  });

  it('opens the lost-cat screen for a match, even though the push also names a sighting', () => {
    expect(notificationRoute({ type: 'lost_cat_match', lost_cat_id: 'x', sighting_id: ID })).toBe(
      '/lost-cat',
    );
  });

  it('ignores payloads it cannot trust', () => {
    expect(notificationRoute(undefined)).toBeNull();
    expect(notificationRoute(null)).toBeNull();
    expect(notificationRoute('nope')).toBeNull();
    expect(notificationRoute({})).toBeNull();
    expect(notificationRoute({ sighting_id: 42 })).toBeNull();
    expect(notificationRoute({ sighting_id: '../../etc/passwd' })).toBeNull();
    expect(notificationRoute({ sighting_id: `${ID}/../x` })).toBeNull();
  });
});

describe('notificationSightingId', () => {
  it('reads a valid id and rejects anything else', () => {
    expect(notificationSightingId({ sighting_id: ID })).toBe(ID);
    expect(notificationSightingId({ sighting_id: 'short' })).toBeNull();
    expect(notificationSightingId(undefined)).toBeNull();
  });
});
