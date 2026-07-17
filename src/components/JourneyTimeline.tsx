import { Image } from 'expo-image';
import { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeInDown, useReducedMotion } from 'react-native-reanimated';

import { MapView, Marker, MAP_PROVIDER, type LatLng, type Region } from '@/components/PlatformMap';
import { Card, Loading, Text } from '@/components/ui';
import { AI_FEATURES } from '@/constants/ai';
import { useJourneyTimeline, type JourneyStop } from '@/hooks/useJourneyTimeline';
import { colors, motion, radius, spacing } from '@/theme';
import { distanceMeters, regionForRadius } from '@/utils/geo';
import { formatDistance, timeAgo } from '@/utils/format';

/**
 * Cat journey timeline (AI-M4 #6). Self-contained, mounted on the sighting
 * detail screen. Shows the cat's movement over time/area once it has ≥2
 * confirmed-linked sightings — helps a guardian actually locate the cat on
 * arrival.
 *
 * Behaviour:
 *   * Returns null when `AI_FEATURES.journeyTimeline` is off, the query is
 *     loading, errored, or there are fewer than 2 stops — silent by design
 *     (it's a nice-to-have visualization, never a blocker).
 *   * Renders a Card with a mini map (numbered markers 1..N in time order)
 *     and a vertical time-ordered list (thumbnail + title + time-ago + the
 *     distance from the previous stop when computable).
 *
 * Coordinates may be coarsened (~110m) for non-owners — that's fine for an
 * overview map; the `isPrecise` flag is passed through but the journey view
 * never claims to be the rescue pin. NEVER imports react-native-maps directly
 * — uses `@/components/PlatformMap`.
 */
export function JourneyTimeline({
  sightingId,
  canManage,
}: {
  sightingId: string;
  canManage: boolean;
}): ReactNode {
  const reduced = useReducedMotion() ?? false;
  const { data, isLoading, isError } = useJourneyTimeline(sightingId, canManage);

  if (!AI_FEATURES.journeyTimeline) return null;
  if (isLoading) return <Loading label="Mapping this cat's journey…" />;
  if (isError) return null;
  if (!data || !data.hasJourney) return null;
  const { stops } = data;

  const region = regionForStops(stops);

  return (
    <Animated.View
      entering={
        reduced
          ? FadeInDown.duration(0)
          : FadeInDown.delay(4.5 * motion.stagger)
              .duration(motion.enter)
              .springify()
              .damping(motion.damping)
      }
    >
      <Card style={styles.card}>
        <View style={styles.head}>
          <Text variant="bodyStrong">🗺️ This cat&apos;s journey</Text>
          <Text variant="small" muted>
            {stops.length} linked sightings over {timeAgo(stops[0].createdAt)} — same cat, confirmed
            by the community.
          </Text>
        </View>

        <View style={styles.mapWrap}>
          <MapView
            provider={MAP_PROVIDER}
            style={styles.map}
            initialRegion={region}
            pointerEvents="none"
          >
            {stops.map((stop, i) => (
              <Marker
                key={stop.sightingId}
                coordinate={{ latitude: stop.lat, longitude: stop.lng } as LatLng}
                pinColor={
                  i === 0
                    ? colors.primary
                    : i === stops.length - 1
                      ? colors.accent
                      : colors.primaryLight
                }
              />
            ))}
          </MapView>
        </View>

        <View style={styles.list}>
          {stops.map((stop, i) => {
            const prev = i > 0 ? stops[i - 1] : null;
            const gapM = prev
              ? distanceMeters({ lat: prev.lat, lng: prev.lng }, { lat: stop.lat, lng: stop.lng })
              : 0;
            return (
              <Animated.View
                key={stop.sightingId}
                entering={
                  reduced
                    ? FadeInDown.duration(0)
                    : FadeInDown.delay(Math.min(i, 6) * motion.stagger)
                        .duration(motion.enter)
                        .springify()
                        .damping(motion.damping)
                }
                style={styles.row}
              >
                <View style={styles.stepCol}>
                  <View style={[styles.stepDot, i === 0 && styles.stepDotFirst]}>
                    <Text variant="caption" color={colors.white}>
                      {i + 1}
                    </Text>
                  </View>
                  {i < stops.length - 1 ? <View style={styles.stepLine} /> : null}
                </View>
                <View style={styles.rowBody}>
                  <View style={styles.rowHead}>
                    {stop.thumbnailUrl ? (
                      <Image
                        source={{ uri: stop.thumbnailUrl }}
                        style={styles.thumb}
                        contentFit="cover"
                      />
                    ) : (
                      <View style={[styles.thumb, styles.thumbFallback]}>
                        <Text variant="caption">🐱</Text>
                      </View>
                    )}
                    <View style={styles.rowInfo}>
                      <Text variant="bodyStrong" numberOfLines={1}>
                        {stop.title?.trim() || `Sighting ${i + 1}`}
                      </Text>
                      <Text variant="small" muted>
                        {timeAgo(stop.createdAt)}
                        {i > 0 && gapM > 0 ? ` · ${formatDistance(gapM)} from previous` : ''}
                      </Text>
                    </View>
                  </View>
                </View>
              </Animated.View>
            );
          })}
        </View>
      </Card>
    </Animated.View>
  );
}

/**
 * Frame the map around all stops. Centroid = mean of lat/lng; radius = the
 * max distance from the centroid to any stop, with a minimum so a single
 * tight cluster doesn't zoom in too far. Falls back to a sensible default
 * when only one stop (shouldn't happen — hasJourney requires ≥2 — but keeps
 * the type happy).
 */
function regionForStops(stops: JourneyStop[]): Region {
  if (stops.length === 0) {
    return regionForRadius(37.7749, -122.4194, 800);
  }
  const lat = stops.reduce((s, p) => s + p.lat, 0) / stops.length;
  const lng = stops.reduce((s, p) => s + p.lng, 0) / stops.length;
  let maxDist = 200;
  for (const p of stops) {
    const d = distanceMeters({ lat, lng }, { lat: p.lat, lng: p.lng });
    if (d > maxDist) maxDist = d;
  }
  return regionForRadius(lat, lng, Math.max(maxDist * 1.6, 300));
}

const styles = StyleSheet.create({
  card: { gap: spacing.md, marginTop: spacing.sm },
  head: { gap: spacing.xs },
  mapWrap: {
    height: 180,
    borderRadius: radius.lg,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
  },
  map: { flex: 1 },
  list: { gap: spacing.xs },
  row: { flexDirection: 'row', gap: spacing.sm },
  stepCol: { alignItems: 'center', width: 24, paddingTop: spacing.xs },
  stepDot: {
    width: 22,
    height: 22,
    borderRadius: 999,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepDotFirst: { backgroundColor: colors.accent },
  stepLine: {
    width: 2,
    flex: 1,
    backgroundColor: colors.divider,
    marginTop: 2,
  },
  rowBody: { flex: 1, paddingBottom: spacing.sm },
  rowHead: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center' },
  thumb: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    backgroundColor: colors.divider,
  },
  thumbFallback: { alignItems: 'center', justifyContent: 'center' },
  rowInfo: { flex: 1, gap: 2 },
});
