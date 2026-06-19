import { StyleSheet, View, ViewProps } from 'react-native';

import { PressableScale } from '@/components/PressableScale';
import { colors, motion, radius, shadow, spacing } from '@/theme';

export interface CardProps extends ViewProps {
  padded?: boolean;
  onPress?: () => void;
}

export function Card({ padded = true, onPress, style, children, ...rest }: CardProps) {
  const content = (
    <View style={[styles.card, padded && styles.padded, style]} {...rest}>
      {children}
    </View>
  );

  if (onPress) {
    return (
      <PressableScale onPress={onPress} scaleTo={motion.cardPressScale}>
        {content}
      </PressableScale>
    );
  }
  return content;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    ...shadow.card,
  },
  padded: { padding: spacing.lg },
});
