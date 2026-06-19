import { Text as RNText, TextProps as RNTextProps, StyleSheet } from 'react-native';

import { colors, typography } from '@/theme';

type Variant = keyof typeof typography;

export interface TextProps extends RNTextProps {
  variant?: Variant;
  color?: string;
  center?: boolean;
  muted?: boolean;
}

export function Text({
  variant = 'body',
  color,
  center,
  muted,
  style,
  ...rest
}: TextProps) {
  return (
    <RNText
      style={[
        typography[variant],
        { color: color ?? (muted ? colors.textSecondary : colors.text) },
        center && styles.center,
        style,
      ]}
      {...rest}
    />
  );
}

const styles = StyleSheet.create({
  center: { textAlign: 'center' },
});
