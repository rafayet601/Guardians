import type { Region } from '@/components/PlatformMap';

const METERS_PER_DEG_LAT = 111_320;

/** Build a map Region centered on a point that roughly frames `radiusM`. */
export function regionForRadius(lat: number, lng: number, radiusM: number): Region {
  const latDelta = (radiusM * 2.4) / METERS_PER_DEG_LAT;
  const lngDelta = latDelta / Math.max(0.2, Math.cos((lat * Math.PI) / 180));
  return {
    latitude: lat,
    longitude: lng,
    latitudeDelta: latDelta,
    longitudeDelta: lngDelta,
  };
}

/** Approximate the visible radius (meters) from a map Region's latitudeDelta. */
export function radiusFromRegion(region: Region): number {
  const meters = (region.latitudeDelta * METERS_PER_DEG_LAT) / 2.4;
  // clamp so we never ask the DB for an absurd radius
  return Math.min(50_000, Math.max(500, Math.round(meters)));
}

/** Haversine distance in meters between two coordinates. */
export function distanceMeters(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6_371_000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Sensible default view (San Francisco) until we have the user's location. */
export const DEFAULT_REGION: Region = {
  latitude: 37.7749,
  longitude: -122.4194,
  latitudeDelta: 0.08,
  longitudeDelta: 0.08,
};
