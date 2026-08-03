// Web map (Stage 1: read-only browse + detail).
// -----------------------------------------------------------------------------
// react-native-maps is native-only, so web gets a Leaflet-backed implementation
// that exposes the SAME surface as PlatformMap.tsx. Because the four consumers
// (app/(tabs)/index.tsx, app/report.tsx, app/sighting/[id].tsx,
// JourneyTimeline) import through this module, none of them need to change.
//
// Leaflet + OpenStreetMap raster tiles were chosen over MapLibre/Google because
// two things map 1:1 to what this app needs: L.circle takes a radius in METERS
// (the 160 m privacy circle ports exactly) and markers can be arbitrary DOM, so
// the existing <MapPin>/<ClusterBubble> React components render as-is via a
// portal — no re-implementation, no react-dom/server. And it needs no API key
// and no billing account.
//
// Clustering is NOT handled here: supercluster already runs in JS inside the
// map screen, so it carries over to web unchanged.
//
// STAGE 1 SCOPE — deliberately not yet implemented:
//   • Marker `draggable` / `onDragEnd` (the report.tsx pin-drag flow). Tapping
//     the map to place a pin DOES work — onPress emits the RN event shape.
//   • `tracksViewChanges` is accepted and ignored (a native rendering hint with
//     no web equivalent).
import 'leaflet/dist/leaflet.css';

import L from 'leaflet';
import {
  createContext,
  forwardRef,
  useContext,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

import { colors } from '@/theme';
import { regionFromCenterZoom, zoomForRegion } from '@/utils/geo';

export type Region = {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
};
export type LatLng = { latitude: number; longitude: number };

// Native picks a provider constant; web has no equivalent, and every consumer
// only ever forwards it to MapView, which ignores it.
export const MAP_PROVIDER = undefined;

const TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

/** Lets Marker/Circle children reach the Leaflet map their parent created. */
const MapContext = createContext<L.Map | null>(null);

export interface MapViewHandle {
  animateToRegion: (region: Region, durationMs?: number) => void;
  fitToCoordinates: (coords: LatLng[]) => void;
}

/**
 * Region → Leaflet view. The viewport size comes from the live container so the
 * Region we report back matches what is actually on screen — this is the value
 * that feeds radiusFromRegion() and therefore the nearby_sightings radius.
 */
function applyRegion(map: L.Map, region: Region, animate: boolean, durationMs: number) {
  const zoom = zoomForRegion(region, map.getSize().y || 780);
  const center: L.LatLngExpression = [region.latitude, region.longitude];
  if (animate) map.flyTo(center, zoom, { duration: Math.max(0.1, durationMs / 1000) });
  else map.setView(center, zoom, { animate: false });
}

function readRegion(map: L.Map): Region {
  const c = map.getCenter();
  const size = map.getSize();
  return regionFromCenterZoom(c.lat, c.lng, map.getZoom(), size.x || 390, size.y || 780);
}

export type MapPressEvent = { nativeEvent: { coordinate: LatLng } };

// The index signature keeps every native-only prop the screens already pass
// (provider, showsMyLocationButton, onPanDrag, tracksViewChanges…) from being a
// JSX type error. It does mean the known props read back as `unknown`, so they
// are pulled out with explicit casts below rather than destructured.
type MapViewProps = { [key: string]: unknown };

export const MapView = forwardRef<MapViewHandle, MapViewProps>(function MapView(props, ref) {
  const children = props.children as ReactNode;
  const style = props.style;
  const initialRegion = props.initialRegion as Region | undefined;
  const showsUserLocation = props.showsUserLocation as boolean | undefined;
  const onPress = props.onPress as ((e: MapPressEvent) => void) | undefined;
  const onRegionChangeComplete = props.onRegionChangeComplete as ((r: Region) => void) | undefined;

  const hostRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const [map, setMap] = useState<L.Map | null>(null);

  // Keep the newest callbacks reachable from Leaflet's handlers without
  // re-binding them — re-binding would mean tearing the map down and
  // recreating it on every parent render.
  const onPressRef = useRef(onPress);
  const onRegionRef = useRef(onRegionChangeComplete);
  useEffect(() => {
    onPressRef.current = onPress;
    onRegionRef.current = onRegionChangeComplete;
  });

  // A non-interactive map (JourneyTimeline passes pointerEvents="none") should
  // not pan, zoom or swallow scroll.
  const interactive = props.pointerEvents !== 'none';
  const initialRef = useRef(initialRegion);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || mapRef.current) return;
    const m = L.map(host, {
      zoomControl: interactive,
      dragging: interactive,
      scrollWheelZoom: interactive,
      doubleClickZoom: interactive,
      touchZoom: interactive,
      keyboard: interactive,
    });
    L.tileLayer(TILE_URL, { attribution: TILE_ATTRIBUTION, maxZoom: 19 }).addTo(m);

    applyRegion(
      m,
      initialRef.current ?? { latitude: 0, longitude: 0, latitudeDelta: 90, longitudeDelta: 180 },
      false,
      0,
    );

    m.on('click', (e: L.LeafletMouseEvent) => {
      onPressRef.current?.({
        nativeEvent: { coordinate: { latitude: e.latlng.lat, longitude: e.latlng.lng } },
      });
    });
    m.on('moveend', () => onRegionRef.current?.(readRegion(m)));

    mapRef.current = m;
    setMap(m);

    // Leaflet measures the container once at creation. Tab screens settle their
    // layout a tick later, so without a re-measure the tiles are sized to a
    // stale box and the map renders in a corner.
    const settle = setTimeout(() => m.invalidateSize(), 0);
    const ro = new ResizeObserver(() => m.invalidateSize());
    ro.observe(host);

    return () => {
      clearTimeout(settle);
      ro.disconnect();
      m.remove();
      mapRef.current = null;
      setMap(null);
    };
  }, [interactive]);

  useImperativeHandle(
    ref,
    (): MapViewHandle => ({
      animateToRegion(region, durationMs = 500) {
        if (mapRef.current) applyRegion(mapRef.current, region, true, durationMs);
      },
      fitToCoordinates(coords) {
        if (!mapRef.current || coords.length === 0) return;
        mapRef.current.fitBounds(
          L.latLngBounds(coords.map((c) => [c.latitude, c.longitude] as L.LatLngTuple)),
          { padding: [40, 40] },
        );
      },
    }),
    [],
  );

  return (
    <div ref={hostRef} style={styleToCss(style)}>
      {map ? <MapContext.Provider value={map}>{children}</MapContext.Provider> : null}
      {map && showsUserLocation ? <UserLocationDot map={map} /> : null}
    </div>
  );
});

/**
 * Marker. Any React children are rendered into the marker's own DOM node via a
 * portal, so <MapPin> / <ClusterBubble> keep their real components, styles and
 * theme tokens — react-native-web turns them into DOM for us.
 */
export function Marker(props: {
  coordinate: LatLng;
  children?: ReactNode;
  anchor?: { x: number; y: number };
  pinColor?: string;
  onPress?: () => void;
  accessibilityLabel?: string;
  [key: string]: unknown;
}) {
  const { coordinate, children, anchor, pinColor, onPress, accessibilityLabel } = props;
  const map = useContext(MapContext);
  const onPressRef = useRef(onPress);
  useEffect(() => {
    onPressRef.current = onPress;
  });

  // We own the marker's DOM node rather than reading it back off Leaflet after
  // mount. That means the portal target exists on first render, so no
  // state-in-effect round-trip is needed to show the marker.
  const [host] = useState(() => document.createElement('div'));

  // iconSize [0,0] puts the node's top-left exactly on the coordinate; the
  // wrapper's transform then applies react-native-maps' fractional `anchor`
  // (default {0.5, 1} = bottom-centre, i.e. a pin's tip).
  const ax = anchor?.x ?? 0.5;
  const ay = anchor?.y ?? 1;

  useEffect(() => {
    if (!map) return;
    const marker = L.marker([coordinate.latitude, coordinate.longitude], {
      icon: L.divIcon({ className: 'guardians-marker', html: host, iconSize: [0, 0] }),
      interactive: true,
      keyboard: false,
      alt: accessibilityLabel ?? '',
    }).addTo(map);
    marker.on('click', (e: L.LeafletMouseEvent) => {
      L.DomEvent.stopPropagation(e); // don't also fire the map's onPress
      onPressRef.current?.();
    });
    return () => {
      marker.remove();
    };
  }, [map, host, coordinate.latitude, coordinate.longitude, accessibilityLabel]);

  return createPortal(
    <div
      style={{
        transform: `translate(${-ax * 100}%, ${-ay * 100}%)`,
        width: 'max-content',
        cursor: onPress ? 'pointer' : 'default',
      }}
    >
      {children ?? <DefaultPin color={pinColor} />}
    </div>,
    host,
  );
}

/** Circle. Leaflet takes the radius in metres, so this is a direct mapping. */
export function Circle(props: {
  center: LatLng;
  radius: number;
  fillColor?: string;
  strokeColor?: string;
  [key: string]: unknown;
}) {
  const { center, radius, fillColor, strokeColor } = props;
  const map = useContext(MapContext);

  useEffect(() => {
    if (!map) return;
    const circle = L.circle([center.latitude, center.longitude], {
      radius,
      color: strokeColor ?? colors.primary,
      fillColor: fillColor ?? colors.primary,
      fillOpacity: 0.15,
      weight: 2,
      interactive: false,
    }).addTo(map);
    return () => {
      circle.remove();
    };
  }, [map, center.latitude, center.longitude, radius, fillColor, strokeColor]);

  return null;
}

// ── internals ────────────────────────────────────────────────────────────────

/** Blue dot for `showsUserLocation`, from the browser geolocation API. */
function UserLocationDot({ map }: { map: L.Map }) {
  useEffect(() => {
    if (!navigator.geolocation) return;
    let marker: L.CircleMarker | null = null;
    let cancelled = false;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (cancelled) return;
        marker = L.circleMarker([pos.coords.latitude, pos.coords.longitude], {
          radius: 7,
          color: '#ffffff',
          weight: 3,
          fillColor: '#1a73e8',
          fillOpacity: 1,
          interactive: false,
        }).addTo(map);
      },
      // Denied or unavailable: the map stays fully usable without the dot.
      () => {},
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 60_000 },
    );
    return () => {
      cancelled = true;
      marker?.remove();
    };
  }, [map]);
  return null;
}

/** Fallback marker for callers that pass `pinColor` instead of children. */
function DefaultPin({ color }: { color?: string }) {
  return (
    <div
      style={{
        width: 16,
        height: 16,
        borderRadius: 8,
        background: color ?? colors.primary,
        border: '2px solid #fff',
        boxShadow: '0 1px 3px rgba(0,0,0,0.4)',
      }}
    />
  );
}

/**
 * Consumers pass RN styles — commonly StyleSheet.absoluteFill, which
 * react-native-web resolves to a registered style ID rather than a plain object.
 * Anything we can't read falls back to filling the parent, which is what every
 * current caller wants.
 */
function styleToCss(style: unknown): CSSProperties {
  const base: CSSProperties = { width: '100%', height: '100%', zIndex: 0 };
  if (style && typeof style === 'object' && !Array.isArray(style)) {
    const s = style as Record<string, unknown>;
    const pick = (k: string) =>
      typeof s[k] === 'number' || typeof s[k] === 'string' ? (s[k] as number | string) : undefined;
    const width = pick('width');
    const height = pick('height');
    const borderRadius = pick('borderRadius');
    return {
      ...base,
      ...(width !== undefined ? { width } : null),
      ...(height !== undefined ? { height } : null),
      ...(borderRadius !== undefined ? { borderRadius, overflow: 'hidden' } : null),
    };
  }
  return { ...base, position: 'absolute', inset: 0 };
}
