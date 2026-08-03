import {
  DEFAULT_REGION,
  distanceMeters,
  radiusFromRegion,
  regionForRadius,
  regionFromCenterZoom,
  zoomForRegion,
} from '@/utils/geo';

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
      radiusFromRegion({
        latitude: 0,
        longitude: 0,
        latitudeDelta: 0.0001,
        longitudeDelta: 0.0001,
      }),
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

// The web PlatformMap shim converts Region ↔ zoom on every pan. The Region it
// emits drives radiusFromRegion() → the nearby_sightings query radius, so an
// error here is a silent correctness bug (wrong area queried), not a visual one.
describe('zoomForRegion ↔ regionFromCenterZoom', () => {
  const W = 390; // a typical phone-width viewport
  const H = 780;

  it('round-trips a region through zoom and back', () => {
    const original = regionForRadius(37.7749, -122.4194, 3000);
    const zoom = zoomForRegion(original, H);
    const back = regionFromCenterZoom(original.latitude, original.longitude, zoom, W, H);

    expect(back.latitude).toBeCloseTo(original.latitude, 6);
    expect(back.longitude).toBeCloseTo(original.longitude, 6);
    // latitudeDelta is the one that matters — it feeds radiusFromRegion.
    expect(back.latitudeDelta).toBeCloseTo(original.latitudeDelta, 6);
  });

  it('preserves the query radius across a round-trip', () => {
    const original = regionForRadius(51.5, -0.12, 5000);
    const zoom = zoomForRegion(original, H);
    const back = regionFromCenterZoom(original.latitude, original.longitude, zoom, W, H);
    expect(radiusFromRegion(back)).toBe(radiusFromRegion(original));
  });

  it('round-trips across a spread of latitudes (Mercator distortion)', () => {
    for (const lat of [-60, -23.5, 0, 23.5, 51.5, 64]) {
      const original = regionForRadius(lat, 10, 2000);
      const zoom = zoomForRegion(original, H);
      const back = regionFromCenterZoom(lat, 10, zoom, W, H);
      expect(back.latitudeDelta).toBeCloseTo(original.latitudeDelta, 6);
    }
  });

  it('zooms IN (higher zoom) for a tighter region', () => {
    const tight = zoomForRegion(regionForRadius(0, 0, 500), H);
    const wide = zoomForRegion(regionForRadius(0, 0, 20_000), H);
    expect(tight).toBeGreaterThan(wide);
  });

  it('clamps to the tile server’s usable zoom range', () => {
    const absurdlyTight = zoomForRegion(
      { latitude: 0, longitude: 0, latitudeDelta: 1e-9, longitudeDelta: 1e-9 },
      H,
    );
    const wholeWorld = zoomForRegion(
      { latitude: 0, longitude: 0, latitudeDelta: 180, longitudeDelta: 360 },
      H,
    );
    expect(absurdlyTight).toBeLessThanOrEqual(19);
    expect(wholeWorld).toBeGreaterThanOrEqual(1);
  });

  it('makes longitudeDelta independent of latitude at a fixed zoom', () => {
    const atEquator = regionFromCenterZoom(0, 0, 12, W, H);
    const upNorth = regionFromCenterZoom(60, 0, 12, W, H);
    expect(upNorth.longitudeDelta).toBeCloseTo(atEquator.longitudeDelta, 9);
    // ...while latitudeDelta shrinks with cos(lat).
    expect(upNorth.latitudeDelta).toBeLessThan(atEquator.latitudeDelta);
  });
});
