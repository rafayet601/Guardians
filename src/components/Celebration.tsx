import { useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeOut, useReducedMotion } from 'react-native-reanimated';

import { RewardBurst } from '@/components/RewardBurst';
import { Text } from '@/components/ui';
import { colors, radius, shadow, spacing } from '@/theme';

export interface CelebrationMessage {
  title: string;
  message: string;
}

interface CelebrationProps {
  /** The moment to celebrate, or null when there is nothing to show. */
  celebration: CelebrationMessage | null;
  /** Called when the moment has been on screen long enough. */
  onDone: () => void;
  durationMs?: number;
}

/**
 * A short, non-blocking "you did something good" moment. Claiming a cat,
 * finishing a rescue and placing a cat in a home used to end in a bare haptic,
 * while the only confetti in the app celebrated spending points. It never
 * intercepts touches, announces itself to screen readers, and drops the
 * confetti (keeping the message) when reduced motion is on.
 */
export function Celebration({ celebration, onDone, durationMs = 3200 }: CelebrationProps) {
  const reduced = useReducedMotion() ?? false;

  // Held in a ref so a parent re-render (which hands us a new callback, and
  // happens right after the mutation that caused this) can't restart the timer.
  const doneRef = useRef(onDone);
  useEffect(() => {
    doneRef.current = onDone;
  });
  useEffect(() => {
    if (!celebration) return;
    const timer = setTimeout(() => doneRef.current(), durationMs);
    return () => clearTimeout(timer);
  }, [celebration, durationMs]);

  if (!celebration) return null;
  return (
    <View
      style={styles.wrap}
      pointerEvents="none"
      accessible
      accessibilityLiveRegion="polite"
      accessibilityLabel={`${celebration.title}. ${celebration.message}`}
    >
      {reduced ? null : <RewardBurst />}
      <Animated.View
        entering={reduced ? undefined : FadeIn.duration(200)}
        exiting={reduced ? undefined : FadeOut.duration(200)}
        style={styles.card}
      >
        <Text variant="heading" center>
          {celebration.title}
        </Text>
        <Text variant="small" muted center>
          {celebration.message}
        </Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    zIndex: 20,
  },
  card: {
    maxWidth: 320,
    gap: spacing.xs,
    padding: spacing.lg,
    borderRadius: radius.xl,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.primarySoft,
    ...shadow.floating,
  },
});
