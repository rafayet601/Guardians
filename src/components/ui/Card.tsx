import { StyleSheet, View, ViewProps } from 'react-native';

import { PressableScale } from '@/components/PressableScale';
import { colors, motion, radius, shadow, spacing } from '@/theme';

export interface CardProps extends ViewProps {
  padded?: boolean;
  onPress?: () => void;
}

export function Card({
  padded = true,
  onPress,
  style,
  children,
  accessibilityLabel,
  accessibilityHint,
  ...rest
}: CardProps) {
  const content = (
    <View
      style={[styles.card, padded && styles.padded, style]}
      {...(!onPress ? { accessibilityLabel, accessibilityHint } : {})}
      {...rest}
    >
      {children}
    </View>
  );

  if (onPress) {
    return (
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityHint={accessibilityHint}
        onPress={onPress}
        scaleTo={motion.cardPressScale}
      >
        {content}
      </PressableScale>
    );
  }
  return content;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.xl,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    ...shadow.card,
  },
  padded: { padding: spacing.lg },
});
