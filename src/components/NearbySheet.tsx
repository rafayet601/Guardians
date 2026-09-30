import { useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
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
import { getDemoSightingPhoto } from '@/utils/demoSightings';
import { Button, EmptyState, Loading, Text } from '@/components/ui';
import { isUrgentNow } from '@/constants/status';
import type { Coords } from '@/hooks/useLocation';
import { colors, motion, radius, shadow, spacing } from '@/theme';
import type { NearbySighting } from '@/types/models';
import { distanceMeters } from '@/utils/geo';
import { sortForTriage } from '@/utils/triage';

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

  // Selecting a pin brings that cat's row into view WITHOUT throwing the sheet
  // over the map: whoever tapped the pin still needs to see it, along with the
  // filters and controls. A sheet the user tucked away comes back to the peek height,
  // one they expanded stays as it is.
  const listRef = useRef<ScrollView>(null);
  const rowOffsets = useRef<Record<string, number>>({});
  useEffect(() => {
    if (!selectedId) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSnap((current) => (current === 'minimized' ? 'peek' : current));
    const y = rowOffsets.current[selectedId];
    if (y !== undefined) {
      listRef.current?.scrollTo({ y: Math.max(0, y - spacing.sm), animated: !reduced });
    }
  }, [selectedId, reduced]);

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

  // Most actionable first, nearest first within a tier. The list is capped, so a
  // plain distance sort would let resolved cats push urgent ones off the end.
  // The selected cat is always kept so a tapped pin always has a row.
  const ordered = useMemo(() => sortForTriage(sightings), [sightings]);
  const rows = useMemo(() => {
    const top = ordered.slice(0, MAX_ROWS);
    const selected = selectedId ? ordered.find((s) => s.id === selectedId) : undefined;
    return selected && !top.includes(selected) ? [...top, selected] : top;
  }, [ordered, selectedId]);
  const hiddenCount = Math.max(0, sightings.length - rows.length);

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
                {loading
                  ? 'Loading…'
                  : failed
                    ? 'Not updated'
                    : hiddenCount > 0
                      ? `${rows.length} of ${sightings.length} · most urgent first`
                      : `${sightings.length} in this area`}
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
          ref={listRef}
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
                onLayout={(event) => {
                  rowOffsets.current[s.id] = event.nativeEvent.layout.y;
                }}
              >
                <SightingCard
                  title={s.title}
                  status={s.status}
                  temperament={s.temperament}
                  color={s.color}
                  isInjured={s.is_injured}
                  needsUrgentHelp={isUrgentNow(s.status, s.needs_urgent_help)}
                  thumbnailUrl={s.thumbnail_url}
                  demoPhoto={getDemoSightingPhoto(s)}
                  seed={s.id}
                  // "X away" means away from the person. The server's distance is
                  // measured from the centre of the map, which reads as wrong the
                  // moment the map is panned.
                  distanceM={coords ? distanceMeters(coords, s) : null}
                  createdAt={s.created_at}
                  onPress={() => onSelect(s.id)}
                />
              </Animated.View>
            ))
          )}
          {hiddenCount > 0 ? (
            <Text variant="small" muted center>
              {hiddenCount} more {hiddenCount === 1 ? 'cat' : 'cats'} in this area. Zoom in to see
              them.
            </Text>
          ) : null}
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
