import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentRef } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeInUp } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PressableScale } from '@/components/PressableScale';
import { MapView, Marker, MAP_PROVIDER, type Region } from '@/components/PlatformMap';
import { SightingCard } from '@/components/SightingCard';
import { Text } from '@/components/ui';
import { STATUS_META, TEMPERAMENT_META } from '@/constants/status';
import { useNearbySightings } from '@/hooks/useSightings';
import { useCurrentLocation } from '@/hooks/useLocation';
import { colors, motion, radius, shadow, spacing } from '@/theme';
import type { CatStatus, NearbySighting } from '@/types/models';
import { DEFAULT_REGION, radiusFromRegion, regionForRadius } from '@/utils/geo';

type Filter = 'all' | 'needs_help' | 'available';

const FILTERS: { key: Filter; label: string; statuses?: CatStatus[] }[] = [
  { key: 'all', label: 'All cats' },
  { key: 'needs_help', label: '🆘 Needs help', statuses: ['spotted', 'claimed', 'in_rescue'] },
  { key: 'available', label: '🏠 Adoptable', statuses: ['available'] },
];

export default function MapScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const mapRef = useRef<ComponentRef<typeof MapView>>(null);
  const { coords } = useCurrentLocation();

  const [region, setRegion] = useState<Region>(DEFAULT_REGION);
  const [filter, setFilter] = useState<Filter>('all');
  const [selected, setSelected] = useState<NearbySighting | null>(null);
  const [tracksChanges, setTracksChanges] = useState(true);
  const tracksTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Briefly allow markers to repaint, then settle to static (perf). A single
  // timer is reused/cleared so overlapping events don't race.
  const pulseTracks = useCallback((ms = 600) => {
    setTracksChanges(true);
    if (tracksTimer.current) clearTimeout(tracksTimer.current);
    tracksTimer.current = setTimeout(() => setTracksChanges(false), ms);
  }, []);

  // Center on the user once we have their location.
  useEffect(() => {
    if (!coords) return;
    const r = regionForRadius(coords.lat, coords.lng, 3000);
    setRegion(r);
    mapRef.current?.animateToRegion(r, 600);
  }, [coords]);

  // Settle marker tracking after first paint; clean up on unmount.
  useEffect(() => {
    pulseTracks(1200);
    return () => {
      if (tracksTimer.current) clearTimeout(tracksTimer.current);
    };
  }, [pulseTracks]);

  // Selecting/deselecting changes a pin's highlight → let it repaint.
  useEffect(() => {
    pulseTracks(500);
  }, [selected, pulseTracks]);

  const params = useMemo(
    () => ({
      lat: region.latitude,
      lng: region.longitude,
      radiusM: radiusFromRegion(region),
      statuses: FILTERS.find((f) => f.key === filter)?.statuses,
    }),
    [region, filter],
  );

  const { data: sightings = [], isFetching } = useNearbySightings(params);

  const recenter = () => {
    if (coords) {
      mapRef.current?.animateToRegion(regionForRadius(coords.lat, coords.lng, 3000), 500);
    }
  };

  return (
    <View style={styles.flex}>
      <MapView
        ref={mapRef}
        provider={MAP_PROVIDER}
        style={StyleSheet.absoluteFill}
        initialRegion={DEFAULT_REGION}
        showsUserLocation
        showsMyLocationButton={false}
        onPress={() => setSelected(null)}
        onRegionChangeComplete={(r) => {
          setRegion(r);
          pulseTracks(800);
        }}
      >
        {sightings.map((s) => (
          <Marker
            key={s.id}
            coordinate={{ latitude: s.lat, longitude: s.lng }}
            onPress={() => setSelected(s)}
            tracksViewChanges={tracksChanges || selected?.id === s.id}
            anchor={{ x: 0.5, y: 1 }}
          >
            <MapPin sighting={s} active={selected?.id === s.id} />
          </Marker>
        ))}
      </MapView>

      {/* Filter chips */}
      <View style={[styles.topBar, { paddingTop: insets.top + spacing.sm }]} pointerEvents="box-none">
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterRow}
        >
          {FILTERS.map((f) => {
            const active = filter === f.key;
            return (
              <PressableScale key={f.key} onPress={() => setFilter(f.key)}>
                <View style={[styles.filterChip, active && styles.filterChipActive]}>
                  <Text
                    variant="smallStrong"
                    color={active ? colors.white : colors.text}
                  >
                    {f.label}
                  </Text>
                </View>
              </PressableScale>
            );
          })}
        </ScrollView>
      </View>

      {/* Recenter button */}
      <PressableScale
        onPress={recenter}
        style={[styles.recenter, { bottom: (selected ? 200 : 24) + insets.bottom }]}
        accessibilityLabel="Recenter map"
      >
        <Ionicons name="locate" size={22} color={colors.primary} />
      </PressableScale>

      {isFetching ? (
        <Animated.View
          entering={FadeIn.duration(motion.enter)}
          style={[styles.fetching, { top: insets.top + 58 }]}
          pointerEvents="none"
        >
          <Text variant="caption" color={colors.white}>
            Updating…
          </Text>
        </Animated.View>
      ) : null}

      {/* Selected sighting card */}
      {selected ? (
        <Animated.View
          entering={FadeInUp.duration(motion.enter).springify().damping(motion.damping)}
          style={[styles.cardWrap, { paddingBottom: insets.bottom + spacing.sm }]}
        >
          <SightingCard
            title={selected.title}
            status={selected.status}
            temperament={selected.temperament}
            color={selected.color}
            isInjured={selected.is_injured}
            needsUrgentHelp={selected.needs_urgent_help}
            thumbnailUrl={selected.thumbnail_url}
            distanceM={coords ? selected.distance_m : null}
            createdAt={selected.created_at}
            onPress={() => router.push(`/sighting/${selected.id}`)}
          />
        </Animated.View>
      ) : null}
    </View>
  );
}

function MapPin({ sighting, active }: { sighting: NearbySighting; active: boolean }) {
  const meta = STATUS_META[sighting.status];
  const temp = TEMPERAMENT_META[sighting.temperament];
  return (
    <View style={[styles.pin, { backgroundColor: meta.fg }, active && styles.pinActive]}>
      <Text style={styles.pinEmoji}>{sighting.needs_urgent_help ? '🚨' : temp.icon}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  topBar: { position: 'absolute', top: 0, left: 0, right: 0 },
  filterRow: { paddingHorizontal: spacing.lg, gap: spacing.sm },
  filterChip: {
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    ...shadow.card,
  },
  filterChipActive: { backgroundColor: colors.primary },
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
  cardWrap: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    bottom: 0,
  },
  pin: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2.5,
    borderColor: colors.white,
    ...shadow.card,
  },
  pinActive: { transform: [{ scale: 1.25 }], borderColor: colors.accent },
  pinEmoji: { fontSize: 18 },
});
