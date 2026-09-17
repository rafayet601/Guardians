import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  FadeInDown,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';

import { SightingCard } from '@/components/SightingCard';
import { Button, EmptyState, Loading, Text } from '@/components/ui';
import type { Coords } from '@/hooks/useLocation';
import { colors, motion, radius, shadow, spacing } from '@/theme';
import type { NearbySighting } from '@/types/models';

interface NearbySheetProps {
  sightings: NearbySighting[];
  coords: Coords | null;
  selectedId?: string | null;
  onSelect: (id: string) => void;
  loading?: boolean;
  failed?: boolean;
  refreshing?: boolean;
  onRetry?: () => void;
  emptyTitle?: string;
  emptyMessage?: string;
}

const SPRING = { damping: motion.damping, stiffness: 220 };
const MAX_ROWS = 25;

/**
 * Persistent, draggable "Sightings nearby" sheet. Drag the header handle to
 * snap between a peek (~⅓ screen) and an expanded list (~80%). The inner list
 * scrolls independently of the drag gesture.
 */
export function NearbySheet({
  sightings,
  coords,
  selectedId,
  onSelect,
  loading,
  failed,
  refreshing,
  onRetry,
  emptyTitle = 'No sightings in this area yet',
  emptyMessage = 'Pan the map or report a cat you have seen.',
}: NearbySheetProps) {
  const router = useRouter();
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  const expandedH = Math.min(height * 0.8, height - 120);
  const peekH = Math.round(height * 0.32);
  const collapsedY = Math.max(0, expandedH - peekH); // translateY at the peek snap

  // Minimized snap: drag the sheet all the way down to just its handle + header
  // so the map is fully visible. Leaves room for the home-indicator inset below.
  const [headerH, setHeaderH] = useState(80);
  const minimizedY = Math.max(collapsedY, expandedH - headerH - insets.bottom);

  const reduced = useReducedMotion() ?? false;
  const [snap, setSnap] = useState<'expanded' | 'peek' | 'minimized'>('peek');
  const translateY = useSharedValue(collapsedY);
  const startY = useSharedValue(collapsedY);

  // Rise into the peek position on mount. We animate translateY directly rather
  // than using a layout `entering` prop, which would fight this drag transform
  // and leave the sheet stuck fully-expanded over the map.
  useEffect(() => {
    translateY.value = reduced ? collapsedY : expandedH;
    if (!reduced) translateY.value = withSpring(collapsedY, SPRING);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // Preserve the chosen snap after rotation or a large-text header resize.
    const target = snap === 'expanded' ? 0 : snap === 'minimized' ? minimizedY : collapsedY;
    translateY.value = reduced ? target : withSpring(target, SPRING);
  }, [collapsedY, minimizedY, translateY, snap, reduced]);

  // Selecting a pin lifts the sheet so its row is visible.
  useEffect(() => {
    if (selectedId) {
      // Synchronize the accessible control with the imperative map-pin expansion.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSnap('expanded');
      translateY.value = reduced ? 0 : withSpring(0, SPRING);
    }
  }, [selectedId, translateY, reduced]);

  const toggleList = () => {
    const expanding = snap !== 'expanded';
    setSnap(expanding ? 'expanded' : 'minimized');
    const target = expanding ? 0 : minimizedY;
    translateY.value = reduced ? target : withSpring(target, SPRING);
  };

  const pan = Gesture.Pan()
    .onStart(() => {
      startY.value = translateY.value;
    })
    .onUpdate((e) => {
      // Clamp between fully expanded (0) and fully minimized (minimizedY).
      translateY.value = Math.min(minimizedY, Math.max(0, startY.value + e.translationY));
    })
    .onEnd((e) => {
      // Project the fling, then snap to the nearest of the three rest points:
      // expanded (0) · peek (collapsedY) · minimized (minimizedY).
      const projected = translateY.value + e.velocityY * 0.12;
      let target = collapsedY;
      if (projected < collapsedY / 2) target = 0;
      else if (projected > (collapsedY + minimizedY) / 2) target = minimizedY;
      translateY.value = reduced ? target : withSpring(target, SPRING);
      scheduleOnRN(
        setSnap,
        target === 0 ? 'expanded' : target === minimizedY ? 'minimized' : 'peek',
      );
    });

  const sheetStyle = useAnimatedStyle(() => ({ transform: [{ translateY: translateY.value }] }));

  const rows = useMemo(
    () => [...sightings].sort((a, b) => a.distance_m - b.distance_m).slice(0, MAX_ROWS),
    [sightings],
  );

  return (
    <Animated.View style={[styles.sheet, { height: expandedH }, sheetStyle]}>
      {/* Drag handle + header (the only pannable zone) */}
      <GestureDetector gesture={pan}>
        <View
          style={styles.header}
          onLayout={(event) => setHeaderH(event.nativeEvent.layout.height)}
        >
          <View style={styles.handle} />
          <View style={styles.headerRow}>
            <View style={styles.headerCopy}>
              <Text variant="heading">Cats nearby</Text>
              <Text variant="caption" color={colors.primary}>
                {loading ? 'Loading…' : failed ? 'Not updated' : `${sightings.length} in this area`}
              </Text>
            </View>
            <Button
              title={snap === 'expanded' ? 'Hide list' : 'Expand list'}
              variant="ghost"
              size="sm"
              onPress={toggleList}
              accessibilityLabel={
                snap === 'expanded' ? 'Hide nearby sightings list' : 'Expand nearby sightings list'
              }
              accessibilityState={{ expanded: snap === 'expanded' }}
            />
          </View>
        </View>
      </GestureDetector>

      {snap !== 'minimized' ? (
        <ScrollView
          contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + spacing.lg }]}
          showsVerticalScrollIndicator={false}
        >
          {failed && rows.length > 0 ? (
            <View style={{ gap: spacing.sm }}>
              <Text variant="small" muted>
                Could not refresh. These sightings may be out of date.
              </Text>
              <Button title="Try again" variant="surface" loading={refreshing} onPress={onRetry} />
            </View>
          ) : null}
          {loading ? (
            <Loading label="Finding sightings in this area…" />
          ) : failed && rows.length === 0 ? (
            <EmptyState
              compact
              title="Could not load sightings"
              message="Check your connection and try again. Nearby cats may still need help."
              actionLabel={refreshing ? 'Retrying…' : 'Try again'}
              onAction={refreshing ? undefined : onRetry}
            />
          ) : rows.length === 0 ? (
            <EmptyState
              compact
              icon="🐾"
              title={emptyTitle}
              message={emptyMessage}
              actionLabel="Report a cat"
              onAction={() => router.push('/report')}
            />
          ) : (
            rows.map((s, i) => (
              <Animated.View
                key={s.id}
                entering={
                  reduced
                    ? FadeInDown.duration(0)
                    : FadeInDown.delay(Math.min(i, 6) * motion.stagger)
                        .duration(motion.enter)
                        .springify()
                        .damping(motion.damping)
                }
                style={[styles.rowWrap, selectedId === s.id && styles.rowSelected]}
              >
                <SightingCard
                  title={s.title}
                  status={s.status}
                  temperament={s.temperament}
                  color={s.color}
                  isInjured={s.is_injured}
                  needsUrgentHelp={s.needs_urgent_help}
                  thumbnailUrl={s.thumbnail_url}
                  seed={s.id}
                  distanceM={coords ? s.distance_m : null}
                  createdAt={s.created_at}
                  onPress={() => onSelect(s.id)}
                />
              </Animated.View>
            ))
          )}
        </ScrollView>
      ) : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: colors.border,
    ...shadow.floating,
  },
  header: { paddingTop: spacing.md, paddingHorizontal: spacing.xl, paddingBottom: spacing.md },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 5,
    borderRadius: radius.pill,
    backgroundColor: colors.border,
    marginBottom: spacing.sm,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.xs,
  },
  headerCopy: { flex: 1, flexShrink: 1 },
  list: { paddingHorizontal: spacing.lg, paddingTop: spacing.xs, gap: spacing.md },
  rowWrap: { borderRadius: radius.lg },
  rowSelected: {
    borderWidth: 1.5,
    borderColor: colors.primary,
    borderRadius: radius.lg,
  },
});
