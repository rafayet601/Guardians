import { FadeIn, FadeInDown } from 'react-native-reanimated';

import { motion } from '@/theme';

/**
 * Returns an `enter(i)` helper that produces a FadeInDown entrance animation
 * respecting the system's Reduce Motion setting. When reduced motion is on,
 * returns a zero-duration animation so content appears instantly.
 *
 * Usage:
 *   const enter = useAnimatedEnter();
 *   <Animated.View entering={enter(0)}>…</Animated.View>
 */
export function useAnimatedEnter(reduced: boolean) {
  return (i: number) => {
    if (reduced) return FadeInDown.duration(0);
    return FadeInDown.delay(i * motion.stagger)
      .duration(motion.enter)
      .springify()
      .damping(motion.damping);
  };
}

/**
 * Returns a FadeIn animation for non-staggered elements (e.g. hero photos,
 * fetching pills) that respects Reduce Motion.
 */
export function useFadeIn(reduced: boolean) {
  if (reduced) return FadeIn.duration(0);
  return FadeIn.duration(motion.enter);
}
