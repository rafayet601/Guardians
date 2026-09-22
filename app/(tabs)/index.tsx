import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentRef } from 'react';
import {
  ActivityIndicator,
  Linking,
  Platform,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';
import Animated, { FadeIn, FadeInDown, useReducedMotion } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Supercluster from 'supercluster';

import { MapSearchBar } from '@/components/MapSearchBar';
import { NearbySheet } from '@/components/NearbySheet';
import { PermissionPrimer } from '@/components/PermissionPrimer';
import { PressableScale } from '@/components/PressableScale';
import { MapView, Marker, MAP_PROVIDER, type Region } from '@/components/PlatformMap';
import { Text } from '@/components/ui';
import { STATUS_META } from '@/constants/status';
import { useNearbySightings } from '@/hooks/useSightings';
import { useCurrentLocation } from '@/hooks/useLocation';
import { confirmAsync, notify } from '@/lib/dialog';
import { hasPrimerBeenShown, markPrimerShown, trackPermissionResult } from '@/lib/permissions';
import { colors, motion, radius, shadow, spacing } from '@/theme';
import type { CatStatus, NearbySighting } from '@/types/models';
import { DEFAULT_REGION, radiusFromRegion, regionForRadius } from '@/utils/geo';

type Filter = 'all' | 'needs_help' | 'available';

const FILTERS: { key: Filter; label: string; statuses?: CatStatus[] }[] = [
  { key: 'all', label: 'All cats' },
  {
    key: 'needs_help',
    label: '🆘 Needs help',
    statuses: ['spotted', 'claimed', 'in_rescue'],
  },
  { key: 'available', label: '🏠 Adoptable', statuses: ['available'] },
];

export default function MapScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { height: winH } = useWindowDimensions();
  const mapRef = useRef<ComponentRef<typeof MapView>>(null);
  const { coords, status: locationStatus, error: locationError, request } = useCurrentLocation();
  const locationActionPending = useRef(false);

  const reduced = useReducedMotion() ?? false;
  const [region, setRegion] = useState<Region>(DEFAULT_REGION);
  const [locationPrimerVisible, setLocationPrimerVisible] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');
  const [selected, setSelected] = useState<NearbySighting | null>(null);
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [tracksChanges, setTracksChanges] = useState(true);
  const tracksTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The sheet peeks ~32% of the screen; float controls just above it.
  const peekH = Math.round(winH * 0.32);
  const controlBottom = peekH + spacing.md;

  // Briefly allow markers to repaint, then settle to static (perf).
  const pulseTracks = useCallback((ms = 600) => {
    setTracksChanges(true);
    if (tracksTimer.current) clearTimeout(tracksTimer.current);
    tracksTimer.current = setTimeout(() => setTracksChanges(false), ms);
  }, []);

  useEffect(() => {
    if (!coords) return;
    const r = regionForRadius(coords.lat, coords.lng, 3000);
    mapRef.current?.animateToRegion(r, 600);
  }, [coords]);

  // Only already-granted permissions may auto-center. Every new OS prompt
  // follows the primer or an explicit tap on the location control.
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const perm = await Location.getForegroundPermissionsAsync();
        if (!active) return;
        if (perm.granted) {
          void request();
          return;
        }
        const shown = await hasPrimerBeenShown('location');
        if (active && !shown && perm.canAskAgain) setLocationPrimerVisible(true);
      } catch {
        // Permission APIs can be unavailable in a browser. The explicit
        // location control remains available to retry and explain recovery.
      }
    })();
    return () => {
      active = false;
    };
  }, [request]);

  useEffect(() => {
    if (locationStatus !== 'denied') return;
    notify(
      locationError ? 'Location unavailable' : 'Location access is off',
      locationError
        ? 'Check that location services are enabled, then tap the location button to retry. You can still explore the map.'
        : Platform.OS === 'web'
          ? 'Allow location for this site in your browser settings, then tap the location button again. You can still explore the map.'
          : 'Tap the location button to retry or open app settings. You can still explore the map.',
    );
  }, [locationStatus, locationError]);

  const allowLocationPrimer = async () => {
    setLocationPrimerVisible(false);
    await markPrimerShown('location');
    const next = await request();
    trackPermissionResult('location', next ? 'granted' : 'denied');
  };

  const dismissLocationPrimer = async () => {
    setLocationPrimerVisible(false);
    await markPrimerShown('location');
    trackPermissionResult('location', 'dismissed');
  };

  useEffect(() => {
    tracksTimer.current = setTimeout(() => setTracksChanges(false), 1200);
    return () => {
      if (tracksTimer.current) clearTimeout(tracksTimer.current);
    };
  }, [pulseTracks]);

  const params = useMemo(
    () => ({
      lat: Math.round(region.latitude * 1000) / 1000,
      lng: Math.round(region.longitude * 1000) / 1000,
      radiusM: radiusFromRegion(region),
      statuses: FILTERS.find((f) => f.key === filter)?.statuses,
    }),
    [region, filter],
  );

  const {
    data: sightings = [],
    isPending,
    isError,
    isFetching,
    refetch,
  } = useNearbySightings(params);

  const recenter = async () => {
    if (locationActionPending.current || locationStatus === 'loading') return;
    locationActionPending.current = true;
    try {
      const permission = await Location.getForegroundPermissionsAsync();
      if (!permission.granted && !permission.canAskAgain) {
        if (Platform.OS === 'web') {
          notify(
            'Location access is off',
            'Allow location for this site in your browser settings, then tap the location button again. You can still explore the map.',
          );
        } else if (
          await confirmAsync({
            title: 'Location access is off',
            message:
              'Enable location for Guardians in app settings, then return and tap the location button again.',
            confirmLabel: 'Open settings',
            cancelLabel: 'Keep browsing',
          })
        ) {
          await Linking.openSettings();
        }
        return;
      }
      if (!permission.granted && !(await hasPrimerBeenShown('location'))) {
        setLocationPrimerVisible(true);
        return;
      }
      await request();
    } catch {
      notify(
        'Location unavailable',
        'Check your device or browser location settings and try again. You can still explore the map.',
      );
    } finally {
      locationActionPending.current = false;
    }
  };

  // Geocode the search query and recenter the map there.
  const onSearch = async () => {
    const q = query.trim();
    if (!q || searching) return;
    setSearching(true);
    try {
      const results = await Location.geocodeAsync(q);
      if (results[0]) {
        const r = regionForRadius(results[0].latitude, results[0].longitude, 3000);
        setRegion(r);
        mapRef.current?.animateToRegion(r, 600);
      } else notify('Place not found', 'Try a more specific address or move the map to your area.');
    } catch {
      notify(
        'Search unavailable',
        'Place search is unavailable right now. Move and zoom the map to browse your area.',
      );
    } finally {
      setSearching(false);
    }
  };

  // ── Marker clustering ──────────────────────────────────────────────────────
  type LeafProps = { sighting: NearbySighting };
  const clusterIndex = useMemo(() => {
    const idx = new Supercluster<LeafProps>({ radius: 60, maxZoom: 18 });
    idx.load(
      sightings.map((s) => ({
        type: 'Feature' as const,
        properties: { sighting: s },
        geometry: { type: 'Point' as const, coordinates: [s.lng, s.lat] as [number, number] },
      })),
    );
    return idx;
  }, [sightings]);

  const clusters = useMemo(() => {
    const zoom = Math.min(
      20,
      Math.max(1, Math.round(Math.log2(360 / Math.max(region.longitudeDelta, 0.0001)))),
    );
    const bbox: [number, number, number, number] = [
      region.longitude - region.longitudeDelta / 2,
      region.latitude - region.latitudeDelta / 2,
      region.longitude + region.longitudeDelta / 2,
      region.latitude + region.latitudeDelta / 2,
    ];
    return clusterIndex.getClusters(bbox, zoom);
  }, [clusterIndex, region]);

  const onClusterPress = (clusterId: number, lat: number, lng: number) => {
    const expansionZoom = Math.min(20, clusterIndex.getClusterExpansionZoom(clusterId));
    const delta = 360 / Math.pow(2, expansionZoom);
    const r = { latitude: lat, longitude: lng, latitudeDelta: delta, longitudeDelta: delta };
    setRegion(r);
    mapRef.current?.animateToRegion(r, 400);
    pulseTracks(600);
  };

  return (
    <View style={styles.flex}>
      <MapView
        ref={mapRef}
        provider={MAP_PROVIDER}
        style={StyleSheet.absoluteFill}
        initialRegion={DEFAULT_REGION}
        showsUserLocation={locationStatus === 'granted'}
        onMapReady={() => {
          if (!coords) return;
          const r = regionForRadius(coords.lat, coords.lng, 3000);
          setRegion(r);
          mapRef.current?.animateToRegion(r, 500);
        }}
        showsMyLocationButton={false}
        onPress={() => {
          setSelected(null);
          pulseTracks(500);
        }}
        onRegionChangeComplete={(r) => {
          setRegion(r);
          pulseTracks(800);
        }}
      >
        {clusters.map((c) => {
          const [lng, lat] = c.geometry.coordinates;
          const props = c.properties as {
            cluster?: boolean;
            cluster_id?: number;
            point_count?: number;
            sighting?: NearbySighting;
          };
          if (props.cluster) {
            return (
              <Marker
                key={`cluster-${props.cluster_id}`}
                coordinate={{ latitude: lat, longitude: lng }}
                onPress={() => onClusterPress(props.cluster_id as number, lat, lng)}
                tracksViewChanges={tracksChanges}
                anchor={{ x: 0.5, y: 0.5 }}
              >
                <ClusterBubble count={props.point_count ?? 0} />
              </Marker>
            );
          }
          const s = props.sighting as NearbySighting;
          return (
            <Marker
              key={s.id}
              coordinate={{ latitude: s.lat, longitude: s.lng }}
              onPress={() => {
                setSelected(s);
                pulseTracks(500);
              }}
              tracksViewChanges={tracksChanges}
              anchor={{ x: 0.5, y: 1 }}
              accessibilityLabel={`${s.title?.trim() || 'Cat sighting'}, ${
                STATUS_META[s.status].label
              }${s.needs_urgent_help ? ', urgent' : ''}`}
              accessibilityState={{ selected: selected?.id === s.id }}
            >
              <MapPin sighting={s} active={selected?.id === s.id} />
            </Marker>
          );
        })}
      </MapView>

      {/* Search + filter chips */}
      <View
        style={[styles.topBar, { paddingTop: insets.top + spacing.sm }]}
        pointerEvents="box-none"
      >
        <View style={styles.searchWrap}>
          <MapSearchBar
            value={query}
            onChangeText={setQuery}
            onSubmit={onSearch}
            submitting={searching}
          />
        </View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterRow}
        >
          {FILTERS.map((f) => {
            const active = filter === f.key;
            return (
              <PressableScale
                key={f.key}
                onPress={() => setFilter(f.key)}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                accessibilityLabel={`Filter: ${f.label}`}
              >
                <View style={[styles.filterChip, active && styles.filterChipActive]}>
                  <Text variant="smallStrong" color={active ? colors.white : colors.text}>
                    {f.label}
                  </Text>
                </View>
              </PressableScale>
            );
          })}
        </ScrollView>
      </View>

      {/* Updating pill */}
      {isFetching ? (
        <Animated.View
          entering={reduced ? undefined : FadeIn.duration(motion.enter)}
          style={[styles.fetching, { top: insets.top + 108, pointerEvents: 'none' }]}
          accessibilityLiveRegion="polite"
        >
          <Text variant="caption" color={colors.white}>
            Updating…
          </Text>
        </Animated.View>
      ) : null}

      {isError && !isFetching ? (
        <PressableScale
          onPress={() => void refetch()}
          style={[styles.fetching, { top: insets.top + 108 }]}
          accessibilityRole="button"
          accessibilityLabel="Sightings could not refresh. Tap to retry."
        >
          <Text variant="caption" color={colors.white}>
            Couldn’t refresh sightings · Tap to retry
          </Text>
        </PressableScale>
      ) : null}

      {/* Recenter */}
      <PressableScale
        onPress={recenter}
        style={[styles.recenter, { bottom: controlBottom + 60 }]}
        accessibilityRole="button"
        accessibilityLabel={
          locationStatus === 'loading' ? 'Finding your location' : 'Recenter map on my location'
        }
        accessibilityState={{
          busy: locationStatus === 'loading',
          disabled: locationStatus === 'loading',
        }}
        disabled={locationStatus === 'loading'}
      >
        {locationStatus === 'loading' ? (
          <ActivityIndicator color={colors.primary} />
        ) : (
          <Ionicons name="locate" size={22} color={colors.primary} />
        )}
      </PressableScale>

      {/* Report pill — sits just above the sheet peek */}
      <Animated.View
        entering={reduced ? undefined : FadeInDown.delay(180).duration(520).springify().damping(12)}
        style={[styles.reportWrap, { bottom: controlBottom }]}
      >
        <PressableScale
          onPress={() => router.push('/report')}
          style={styles.report}
          scaleTo={0.9}
          accessibilityRole="button"
          accessibilityLabel="Report a cat"
        >
          <Ionicons name="add" size={20} color={colors.white} />
          <Text variant="smallStrong" color={colors.white}>
            Report
          </Text>
        </PressableScale>
      </Animated.View>

      {/* Persistent nearby sheet */}
      <NearbySheet
        sightings={sightings}
        loading={isPending}
        failed={isError}
        refreshing={isFetching}
        onRetry={() => void refetch()}
        emptyTitle={
          filter === 'available'
            ? 'No adoptable cats in this area'
            : filter === 'needs_help'
              ? 'No matching help requests here'
              : 'No sightings in this area yet'
        }
        emptyMessage="Try another area or filter. Reports come from the community, so an empty map does not mean every cat is safe."
        coords={coords}
        selectedId={selected?.id}
        onSelect={(id) => router.push(`/sighting/${id}`)}
      />

      {/* One-time location primer — the map works on the default region either way */}
      <PermissionPrimer
        visible={locationPrimerVisible}
        kind="location"
        onAllow={allowLocationPrimer}
        onDismiss={dismissLocationPrimer}
      />
    </View>
  );
}

function ClusterBubble({ count }: { count: number }) {
  const size = count >= 100 ? 56 : count >= 10 ? 48 : 40;
  return (
    <View style={[styles.cluster, { width: size, height: size, borderRadius: size / 2 }]}>
      <Text variant="smallStrong" color={colors.white}>
        {count}
      </Text>
    </View>
  );
}

function MapPin({ sighting, active }: { sighting: NearbySighting; active: boolean }) {
  const meta = STATUS_META[sighting.status];
  const urgent = sighting.needs_urgent_help;
  const color = urgent ? colors.urgent : meta.fg;
  return (
    <View style={[styles.pinWrap, active && styles.pinWrapActive]}>
      <View
        style={[
          styles.pinHead,
          { backgroundColor: color, borderColor: active ? colors.accent : colors.white },
        ]}
      >
        <Ionicons name={urgent ? 'alert' : 'paw'} size={16} color={colors.white} />
      </View>
      <View style={[styles.pinTail, { borderTopColor: color }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  topBar: { position: 'absolute', top: 0, left: 0, right: 0, gap: spacing.sm },
  searchWrap: { paddingHorizontal: spacing.lg },
  filterRow: { paddingHorizontal: spacing.lg, gap: spacing.sm, paddingVertical: spacing.xs },
  filterChip: {
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.card,
  },
  filterChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  recenter: {
    position: 'absolute',
    right: spacing.lg,
    width: 48,
    height: 48,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadow.floating,
  },
  fetching: {
    position: 'absolute',
    alignSelf: 'center',
    backgroundColor: colors.overlay,
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
    borderRadius: radius.pill,
  },
  reportWrap: { position: 'absolute', right: spacing.lg },
  report: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    height: 48,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
    ...shadow.floating,
  },
  pinWrap: { alignItems: 'center' },
  pinWrapActive: { transform: [{ scale: 1.25 }] },
  pinHead: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2.5,
    ...shadow.card,
  },
  pinDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.white },
  pinGlyph: { fontSize: 15 },
  pinTail: {
    width: 0,
    height: 0,
    marginTop: -3,
    borderLeftWidth: 6,
    borderRightWidth: 6,
    borderTopWidth: 9,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
  },
  cluster: {
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2.5,
    borderColor: colors.white,
    ...shadow.card,
  },
});
