import { forwardRef, useState } from 'react';
import { StyleSheet, TextInput, TextInputProps, View } from 'react-native';
import Animated, {
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { colors, radius, spacing, typography } from '@/theme';
import { Text } from './Text';

const AnimatedTextInput = Animated.createAnimatedComponent(TextInput);

export interface InputProps extends TextInputProps {
  label?: string;
  error?: string | null;
  hint?: string;
}

export const Input = forwardRef<TextInput, InputProps>(function Input(
  { label, error, hint, style, multiline, onFocus, onBlur, ...rest },
  ref,
) {
  const [focused, setFocused] = useState(false);
  const focus = useSharedValue(0);

  // Border eases between resting and focused; error pins it red either way.
  const animatedBorder = useAnimatedStyle(() => {
    if (error) return { borderColor: colors.danger };
    return {
      borderColor: interpolateColor(focus.value, [0, 1], [colors.border, colors.primary]),
    };
  });

  return (
    <View style={styles.wrap}>
      {label ? (
        <Text variant="smallStrong" color={focused ? colors.primary : colors.textSecondary} style={styles.label}>
          {label}
        </Text>
      ) : null}
      <AnimatedTextInput
        ref={ref}
        placeholderTextColor={colors.textMuted}
        style={[styles.input, multiline && styles.multiline, animatedBorder, style]}
        multiline={multiline}
        onFocus={(e) => {
          setFocused(true);
          focus.value = withTiming(1, { duration: 160 });
          onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          focus.value = withTiming(0, { duration: 160 });
          onBlur?.(e);
        }}
        {...rest}
      />
      {error ? (
        <Text variant="small" color={colors.danger} style={styles.helper}>
          {error}
        </Text>
      ) : hint ? (
        <Text variant="small" color={colors.textMuted} style={styles.helper}>
          {hint}
        </Text>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: { gap: spacing.xs },
  label: { marginLeft: 2 },
  input: {
    ...typography.body,
    color: colors.text,
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    minHeight: 48,
  },
  multiline: { minHeight: 96, textAlignVertical: 'top', paddingTop: spacing.md },
  helper: { marginLeft: 2 },
});
