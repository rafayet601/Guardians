import { ReactNode } from 'react';
import { Pressable, PressableProps, StyleProp, ViewStyle } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  useReducedMotion,
  withSpring,
} from 'react-native-reanimated';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

interface PressableScaleProps extends Omit<PressableProps, 'style'> {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  /** How far to shrink while pressed. */
  scaleTo?: number;
}

/**
 * A Pressable that springs inward on press — the app's standard tactile
 * micro-interaction. Driven on the UI thread via Reanimated.
 */
export function PressableScale({ children, style, scaleTo = 0.96, ...rest }: PressableScaleProps) {
  const scale = useSharedValue(1);
  const reduced = useReducedMotion();
  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <AnimatedPressable
      onPressIn={() => {
        scale.value = reduced ? 1 : withSpring(scaleTo, { duration: 150, dampingRatio: 1 });
      }}
      onPressOut={() => {
        scale.value = reduced ? 1 : withSpring(1, { duration: 150, dampingRatio: 1 });
      }}
      style={[style, animatedStyle]}
      {...rest}
    >
      {children}
    </AnimatedPressable>
  );
}
