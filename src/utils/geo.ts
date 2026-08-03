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

// ── Region ↔ Web-Mercator zoom ───────────────────────────────────────────────
// react-native-maps thinks in Regions (center + lat/lng deltas); every web map
// engine thinks in center + integer-ish zoom. The web PlatformMap shim converts
// between them, and it must be exact in ONE direction in particular: the Region
// emitted by onRegionChangeComplete feeds radiusFromRegion(), which sets the
// `nearby_sightings` query radius. A wrong delta silently queries the wrong
// area, so this math lives here next to that function and is unit-tested,
// rather than being buried in the map component.

/** Meters per screen pixel in Web Mercator at a given latitude + zoom. */
const METERS_PER_PIXEL_AT_ZOOM_0 = 156_543.033_92; // equator, 256px tiles
function metersPerPixel(lat: number, zoom: number): number {
  return (METERS_PER_PIXEL_AT_ZOOM_0 * Math.cos((lat * Math.PI) / 180)) / 2 ** zoom;
}

/** Leaflet/OSM practical bounds — beyond these the tile server has no imagery. */
const MIN_ZOOM = 1;
const MAX_ZOOM = 19;

/**
 * Zoom level that renders `region` in a viewport `heightPx` tall.
 * Derived from latitudeDelta (not longitudeDelta) to stay consistent with
 * radiusFromRegion, which also keys off latitude.
 */
export function zoomForRegion(region: Region, heightPx: number): number {
  const visibleMeters = Math.max(1e-6, region.latitudeDelta) * METERS_PER_DEG_LAT;
  const raw = Math.log2(
    (Math.max(1, heightPx) *
      METERS_PER_PIXEL_AT_ZOOM_0 *
      Math.cos((region.latitude * Math.PI) / 180)) /
      visibleMeters,
  );
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, raw));
}

/**
 * Inverse of `zoomForRegion` — the Region a viewport shows at a given center +
 * zoom. Note longitudeDelta is latitude-independent: in Mercator, degrees of
 * longitude per pixel depend only on zoom.
 */
export function regionFromCenterZoom(
  lat: number,
  lng: number,
  zoom: number,
  widthPx: number,
  heightPx: number,
): Region {
  const mpp = metersPerPixel(lat, zoom);
  const latitudeDelta = (Math.max(1, heightPx) * mpp) / METERS_PER_DEG_LAT;
  const longitudeDelta =
    (Math.max(1, widthPx) * METERS_PER_PIXEL_AT_ZOOM_0) / (2 ** zoom * METERS_PER_DEG_LAT);
  return { latitude: lat, longitude: lng, latitudeDelta, longitudeDelta };
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
