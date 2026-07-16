import { Image } from 'expo-image';
import { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeInDown, useReducedMotion } from 'react-native-reanimated';

import { Button, Card, Text } from '@/components/ui';
import { AI_FEATURES } from '@/constants/ai';
import {
  useConfirmSightingLink,
  useReidCandidates,
  useRejectSightingLink,
} from '@/hooks/useReid';
import { confirmAsync } from '@/lib/dialog';
import { colors, motion, radius, spacing } from '@/theme';

/**
 * Duplicate-sighting detection / cat re-ID (AI-M3 #4). Renders "this might be
 * the same cat as [X]" candidates under a sighting detail. Mirrors
 * AdoptionDraftCard's styling (Card + theme tokens + reanimated FadeInDown).
 *
 * Behaviour:
 *   * Returns null when the `reid` feature flag is off, when the query is
 *     loading or errored, or when there are no candidates — silent by design.
 *   * Each candidate shows a thumbnail, title, and "≈83% similar · 1.2 km"
 *     (confidence + distance — distance is server-side, never raw coords).
 *   * When `canManage` is true and the candidate has a link id, "Yes, same cat"
 *     and "No" buttons trigger a confirmAsync dialog before the confirm/reject
 *     mutation. Links are reversible — both dialogs say so.
 *
 * Never auto-merges. The reporter/guardian makes every decision.
 */
export function ReidSuggestions({
  sightingId,
  canManage,
}: {
  sightingId: string;
  canManage: boolean;
}): ReactNode {
  const reduced = useReducedMotion() ?? false;
  const { data: candidates, isLoading, isError } = useReidCandidates(sightingId);
  const confirm = useConfirmSightingLink(sightingId);
  const reject = useRejectSightingLink(sightingId);

  if (!AI_FEATURES.reid) return null;
  if (isLoading || isError) return null;
  if (!candidates || candidates.length === 0) return null;

  const onConfirm = async (linkId: string) => {
    const ok = await confirmAsync({
      title: 'Same cat?',
      message: 'Linking the two sightings as the same cat. You can undo this later.',
      confirmLabel: 'Yes, same cat',
    });
    if (!ok) return;
    confirm.mutate(linkId);
  };

  const onReject = async (linkId: string) => {
    const ok = await confirmAsync({
      title: 'Different cat?',
      message: 'Marking the two sightings as different cats. You can undo this later.',
      confirmLabel: 'No, different',
      destructive: true,
    });
    if (!ok) return;
    reject.mutate(linkId);
  };

  return (
    <Animated.View
      entering={reduced ? FadeInDown.duration(0) : FadeInDown.delay(4.5 * motion.stagger)
        .duration(motion.enter)
        .springify()
        .damping(motion.damping)}
    >
      <Card style={styles.card}>
        <View style={styles.head}>
          <Text variant="bodyStrong">Might be the same cat</Text>
          <Text variant="small" muted>
            AI compared the photo, location, and time. You decide — links are reversible.
          </Text>
        </View>
        {candidates.map((c) => (
          <View key={c.linkedSightingId} style={styles.row}>
            {c.thumbnailUrl ? (
              <Image source={{ uri: c.thumbnailUrl }} style={styles.thumb} contentFit="cover" />
            ) : (
              <View style={[styles.thumb, styles.thumbFallback]}>
                <Text variant="body">🐱</Text>
              </View>
            )}
            <View style={styles.info}>
              <Text variant="bodyStrong" numberOfLines={1}>
                {c.title || 'Cat sighting'}
              </Text>
              <Text variant="small" muted>
                ≈{Math.round(c.confidence * 100)}% similar{c.distanceM != null ? ` · ${formatDistance(c.distanceM)}` : ''}
              </Text>
            </View>
            {canManage && c.linkId ? (
              <View style={styles.actions}>
                <Button
                  title="Yes"
                  size="sm"
                  loading={confirm.isPending}
                  onPress={() => onConfirm(c.linkId!)}
                  style={styles.flex}
                />
                <Button
                  title="No"
                  size="sm"
                  variant="outline"
                  loading={reject.isPending}
                  onPress={() => onReject(c.linkId!)}
                  style={styles.flex}
                />
              </View>
            ) : null}
          </View>
        ))}
      </Card>
    </Animated.View>
  );
}

function formatDistance(m: number): string {
  if (m >= 1000) return `${(m / 1000).toFixed(1)} km`;
  return `${Math.round(m)} m`;
}

const styles = StyleSheet.create({
  card: { gap: spacing.md, marginTop: spacing.sm },
  head: { gap: spacing.xs },
  row: { gap: spacing.sm },
  thumb: {
    width: 48,
    height: 48,
    borderRadius: radius.md,
    backgroundColor: colors.divider,
  },
  thumbFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  info: { gap: 2 },
  actions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  flex: { flex: 1 },
});
