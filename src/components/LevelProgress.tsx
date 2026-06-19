import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
} from 'react-native-reanimated';

import { Text } from '@/components/ui';
import { colors, radius, spacing } from '@/theme';
import { compactNumber, levelProgress } from '@/utils/format';

export function LevelProgress({ points }: { points: number }) {
  const { level, intoLevel, span, toNext, progress } = levelProgress(points);

  // Fill eases up from empty so the bar feels earned, not just printed.
  const fill = useSharedValue(0);
  useEffect(() => {
    fill.value = withDelay(140, withSpring(progress, { damping: 18, stiffness: 90 }));
  }, [fill, progress]);
  const fillStyle = useAnimatedStyle(() => ({ width: `${Math.min(100, Math.max(0, fill.value * 100))}%` }));

  return (
    <View style={styles.wrap}>
      <View style={styles.header}>
        <View style={styles.levelBadge}>
          <Text variant="caption" color={colors.white}>
            LVL
          </Text>
          <Text variant="heading" color={colors.white}>
            {level}
          </Text>
        </View>
        <View style={styles.info}>
          <Text variant="subheading">{compactNumber(points)} points</Text>
          <Text variant="small" muted>
            {toNext > 0 ? `${toNext} pts to level ${level + 1}` : 'Max level reached'}
          </Text>
        </View>
      </View>

      <View style={styles.track}>
        <Animated.View style={[styles.fill, fillStyle]} />
      </View>
      <Text variant="caption" muted style={styles.caption}>
        {intoLevel}/{span} XP this level
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  levelBadge: {
    width: 60,
    height: 60,
    borderRadius: radius.lg,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  info: { flex: 1, gap: 2 },
  track: {
    height: 12,
    borderRadius: radius.pill,
    backgroundColor: colors.divider,
    overflow: 'hidden',
  },
  fill: { height: '100%', backgroundColor: colors.accent, borderRadius: radius.pill },
  caption: { alignSelf: 'flex-end' },
});
