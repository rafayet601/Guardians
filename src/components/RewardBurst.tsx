import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';

import { palette } from '@/theme';

const CONFETTI = [palette.amber500, palette.green500, palette.amber600, palette.green300, palette.pink500];
const COUNT = 16;

// Particle vectors are computed once at module load so they stay stable across
// re-renders (and `Math.random` is only touched here, not during animation).
const PARTICLES = Array.from({ length: COUNT }, (_, i) => {
  const angle = (Math.PI * 2 * i) / COUNT + (Math.random() - 0.5) * 0.5;
  const distance = 80 + Math.random() * 70;
  return {
    dx: Math.cos(angle) * distance,
    dy: Math.sin(angle) * distance,
    color: CONFETTI[i % CONFETTI.length],
    size: 7 + Math.random() * 7,
    delay: Math.random() * 90,
    spin: (Math.random() - 0.5) * 540,
    round: i % 2 === 0,
  };
});

type Particle = (typeof PARTICLES)[number];

/**
 * A one-shot celebratory confetti burst, radiating from its center. Mount it
 * (e.g. when a redemption succeeds) and it plays once. Non-interactive.
 */
export function RewardBurst() {
  return (
    <View pointerEvents="none" style={styles.wrap}>
      {PARTICLES.map((p, i) => (
        <Bit key={i} p={p} />
      ))}
    </View>
  );
}

function Bit({ p }: { p: Particle }) {
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withDelay(
      p.delay,
      withTiming(1, { duration: 720, easing: Easing.out(Easing.cubic) }),
    );
  }, [progress, p.delay]);

  const style = useAnimatedStyle(() => ({
    opacity: 1 - progress.value * progress.value,
    transform: [
      { translateX: progress.value * p.dx },
      { translateY: progress.value * p.dy },
      { scale: 0.4 + progress.value * 0.9 },
      { rotate: `${progress.value * p.spin}deg` },
    ],
  }));

  return (
    <Animated.View
      style={[
        styles.bit,
        { width: p.size, height: p.size, backgroundColor: p.color, borderRadius: p.round ? p.size / 2 : 2 },
        style,
      ]}
    />
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
    zIndex: 10,
  },
  bit: { position: 'absolute' },
});
