import { DEFAULT_REGION, distanceMeters, radiusFromRegion, regionForRadius } from '@/utils/geo';

describe('regionForRadius', () => {
  it('centers on the given point with positive deltas', () => {
    const r = regionForRadius(37.77, -122.42, 1000);
    expect(r.latitude).toBe(37.77);
    expect(r.longitude).toBe(-122.42);
    expect(r.latitudeDelta).toBeGreaterThan(0);
    expect(r.longitudeDelta).toBeGreaterThan(0);
  });

  it('produces a larger viewport for a larger radius', () => {
    expect(regionForRadius(0, 0, 5000).latitudeDelta).toBeGreaterThan(
      regionForRadius(0, 0, 1000).latitudeDelta,
    );
  });
});

describe('radiusFromRegion', () => {
  it('clamps very small regions up to 500m', () => {
    expect(
      radiusFromRegion({ latitude: 0, longitude: 0, latitudeDelta: 0.0001, longitudeDelta: 0.0001 }),
    ).toBe(500);
  });

  it('clamps very large regions down to 50km', () => {
    expect(
      radiusFromRegion({ latitude: 0, longitude: 0, latitudeDelta: 100, longitudeDelta: 100 }),
    ).toBe(50_000);
  });

  it('round-trips with regionForRadius', () => {
    const back = radiusFromRegion(regionForRadius(40, -70, 3000));
    expect(Math.abs(back - 3000)).toBeLessThan(50);
  });
});

describe('distanceMeters (haversine)', () => {
  it('is zero for the same point', () => {
    expect(distanceMeters({ lat: 10, lng: 10 }, { lat: 10, lng: 10 })).toBeCloseTo(0, 5);
  });

  it('is ~111km for one degree of latitude', () => {
    const d = distanceMeters({ lat: 0, lng: 0 }, { lat: 1, lng: 0 });
    expect(d).toBeGreaterThan(110_000);
    expect(d).toBeLessThan(112_000);
  });
});

describe('DEFAULT_REGION', () => {
  it('is a sane San Francisco starting view', () => {
    expect(DEFAULT_REGION.latitude).toBeCloseTo(37.77, 1);
    expect(DEFAULT_REGION.latitudeDelta).toBeGreaterThan(0);
  });
});
